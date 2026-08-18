/* Accounting for the class-instance dyn box (SCR_DYN_OBJINST).
 *
 * The box states three facts about a class — its preorder interval, whether
 * its instances carry the rc+vt hierarchy prefix, and its RC pair — and
 * each of those already lives somewhere else: in ClassMeta, which
 * `instanceof` reads, and in rcAdapters, which every container slot reads.
 * The two backends build the descriptor SEPARATELY (a C static initialiser,
 * an LLVM internal constant), so "derived from one source" is a claim that
 * can rot in one lane and not the other, silently — a box whose interval is
 * one number off narrows to the wrong class, and nothing about that reads
 * like a build error.
 *
 * So the derivation is checked mechanically, from three directions:
 *
 *  1. the dyn KIND NUMBERS the LLVM lane hardcodes are checked against the
 *     C enum in scr_runtime.h, position by position — the hazard the enum's
 *     own comment warns about, now enforced rather than remembered;
 *  2. the same program is compiled through BOTH backends and the emitted
 *     descriptors are compared field for field, so the two lanes cannot
 *     disagree about what a box contains;
 *  3. every class the program boxes must be one canBoxClassIntoDyn admits,
 *     in BOTH directions — a class that can be widened but not narrowed
 *     would strand its values, which is the failure mode the method-bundle
 *     comment in nodes.ts records from the last time it happened.
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "../src/index.js";
import { DK } from "../src/backend/llvm/dyn.js";
import { canBoxClassIntoDyn, canConvertToDyn, canDynCheckTo, RUNTIME_ERROR_CLASSES, RUNTIME_STREAM_CLASSES, RUNTIME_EMITTER_CLASS } from "../src/ir/nodes.js";
import type { IrType } from "../src/ir/nodes.js";

const repoRoot = join(import.meta.dirname, "../../..");
const headerPath = join(repoRoot, "packages/runtime/src/scr_runtime.h");

/** A program exercising all three class shapes a descriptor can describe:
 * standalone (no vt word), hierarchy member (base and derived), and a
 * runtime-provided class (RC pair from the runtime, interval stamped into
 * the runtime vtable at main()). */
const PROGRAM = `
import { Readable } from "node:stream";
class Lone { n: number; constructor(n: number) { this.n = n; } }
class Base { tag: string; constructor(t: string) { this.tag = t; } kind(): string { return "base"; } }
class Derived extends Base { extra: number; constructor(e: number) { super("d"); this.extra = e; } kind(): string { return "derived"; } }
function carry(v: unknown): unknown { return v; }
const lone = new Lone(1);
const der = new Derived(2);
const base: Base = der;
const rs = Readable.from(["x"]);
console.log((carry(lone) as Lone).n);
console.log((carry(base) as Derived).extra);
console.log((carry(rs) as Readable) === rs);
`;

async function compileBoth(): Promise<{ c: string; ll: string }> {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-dynbox-"));
  const src = join(dir, "main.ts");
  await writeFile(src, PROGRAM, "utf8");
  const out: Record<string, string> = {};
  for (const backend of ["c", "llvm"] as const) {
    const res = await compile(src, {
      outPath: join(dir, `program-${backend}`),
      outDir: dir,
      backend,
      emitOnly: true,
    });
    if (!res.ok) {
      throw new Error(`${backend} backend refused the descriptor program: ${res.diagnostics[0]?.message ?? "?"}`);
    }
    out[backend] = await readFile(res.cPath, "utf8");
  }
  return { c: out.c!, ll: out.llvm! };
}

/** One comparable row per class, keyed by display name — every field both
 * lanes state and could state differently.
 *
 * The RC symbols are compared with a trailing `_v` removed, and that is
 * not papering over a difference: rcAdapters' header says it outright. C's
 * per-shape helper is TYPED, so C appends `_v` to reach the void*-thunk; in
 * LLVM every value is already `ptr`, so the base name IS the thunk. The
 * pair is the same pair. What the comparison is for is the case where one
 * lane reaches a DIFFERENT class's helpers, which survives the strip. */
const rcBase = (sym: string): string => sym.replace(/_v$/, "");
function cDescriptors(c: string): Map<string, string> {
  const out = new Map<string, string>();
  // static const ScrDynClass sc_dcl_0 = { "Lone", 5, 5, false, &r, &rl }; /* dyn box: class Lone */
  const re = /static const ScrDynClass sc_dcl_\d+ = \{ "([^"]*)", (\d+), (\d+), (true|false), &(\w+), &(\w+) \};/g;
  for (const m of c.matchAll(re)) {
    out.set(m[1]!, `pre=${m[2]} post=${m[3]} vt=${m[4]} rc=${rcBase(m[5]!)}/${rcBase(m[6]!)}`);
  }
  return out;
}

function llDescriptors(ll: string): Map<string, string> {
  // @sc_dcl_0 = internal constant %ScrDynClass { ptr @sc_cs_3, i64 5, i64 5, i8 0, ptr @r, ptr @rl } ; dyn box: class Lone
  const cstrs = new Map<string, string>();
  for (const m of ll.matchAll(/^@(sc_cs_\d+) = internal constant \[\d+ x i8\] c"([^"]*)\\00"/gm)) {
    cstrs.set(m[1]!, m[2]!);
  }
  const out = new Map<string, string>();
  const re =
    /^@sc_dcl_\d+ = internal constant %ScrDynClass \{ ptr @(sc_cs_\d+), i64 (\d+), i64 (\d+), i8 ([01]), ptr @(\w+), ptr @(\w+) \}/gm;
  for (const m of ll.matchAll(re)) {
    const name = cstrs.get(m[1]!);
    if (name === undefined) throw new Error(`llvm descriptor names an undefined cstr ${m[1]}`);
    out.set(
      name,
      `pre=${m[2]} post=${m[3]} vt=${m[4] === "1" ? "true" : "false"} rc=${rcBase(m[5]!)}/${rcBase(m[6]!)}`,
    );
  }
  return out;
}

describe("the class-instance dyn box's bookkeeping", () => {
  test("the LLVM lane's dyn kind numbers are the C enum's, position by position", async () => {
    const header = await readFile(headerPath, "utf8");
    const body = /typedef enum \{([\s\S]*?)\} ScrDynKind;/.exec(header)?.[1];
    expect(body, "ScrDynKind not found in scr_runtime.h").toBeDefined();
    // Strip comments, then take the bare SCR_DYN_* names in declaration
    // order — no `= n` initialisers appear in this enum, so position IS
    // the value, which is exactly the fragile part.
    const stripped = body!.replace(/\/\*[\s\S]*?\*\//g, "");
    const all = [...stripped.matchAll(/\bSCR_DYN_(\w+)\b/g)].map((m) => m[1]!);
    // KIND_COUNT closes the enum and is not a kind — it is the count, so
    // per-kind tables size themselves rather than being written out and
    // going stale. It must be LAST, because that is exactly what makes
    // every real kind's position its value; asserting the POSITION rather
    // than merely filtering the name is what keeps this test's own premise
    // ("position IS the value") honest.
    expect(all[all.length - 1], "SCR_DYN_KIND_COUNT must be the LAST enumerator")
      .toBe("KIND_COUNT");
    const names = all.slice(0, -1);
    expect(names.length).toBeGreaterThan(10);
    const fromHeader = Object.fromEntries(names.map((n, i) => [n, i]));
    // Every DK row must name a real enum member AND carry its position.
    expect(DK).toEqual(fromHeader);
  });

  test("both backends emit the same descriptor for the same class", async () => {
    const { c, ll } = await compileBoth();
    const cs = cDescriptors(c);
    const ls = llDescriptors(ll);
    // Exactly four rows, and the set itself is the first thing checked: a
    // lane that stopped boxing one (or started boxing a fifth) fails here
    // before any field is read. `Base` is in the set because a descriptor
    // is interned per STATIC type at the crossing — `carry(base)` widens a
    // Base-typed slot — while `Derived` is interned by the narrow that
    // reads the instance's own vtable position back out. That pair is the
    // hierarchy mechanism, so seeing both names here is the point.
    expect([...cs.keys()].sort()).toEqual(["Base", "Derived", "Lone", "Readable"]);
    expect([...ls.keys()].sort()).toEqual([...cs.keys()].sort());
    for (const [name, row] of cs) expect(`${name}: ${ls.get(name)}`).toBe(`${name}: ${row}`);
  });

  test("a standalone class has no vt word and a hierarchy member does", async () => {
    const { c } = await compileBoth();
    const cs = cDescriptors(c);
    expect(cs.get("Lone")).toMatch(/vt=false/);
    // Derived is a hierarchy member, so the box reads the instance's OWN
    // vtable position — which is what lets a Base-typed widening narrow
    // back to Derived.
    expect(cs.get("Base")).toMatch(/vt=true/);
    expect(cs.get("Derived")).toMatch(/vt=true/);
    expect(cs.get("Readable")).toMatch(/vt=true/);
  });

  test("every boxable class boxes in BOTH directions, and the error hierarchy in neither", () => {
    const noRec = (): undefined => undefined;
    const obj = (className: string): IrType => ({ kind: "object", className });
    const boxable = [
      "Lone",
      "Derived",
      RUNTIME_EMITTER_CLASS,
      ...RUNTIME_STREAM_CLASSES.keys(),
    ];
    for (const cls of boxable) {
      expect(canBoxClassIntoDyn(cls), `${cls} should be boxable`).toBe(true);
      // Symmetry is the property that matters: a class admitted IN but not
      // OUT would let a value cross and strand it.
      expect(canConvertToDyn(obj(cls), noRec, noRec), `${cls} widens`).toBe(true);
      expect(canDynCheckTo(obj(cls), noRec, noRec), `${cls} narrows`).toBe(true);
    }
    for (const cls of RUNTIME_ERROR_CLASSES.keys()) {
      expect(canBoxClassIntoDyn(cls), `${cls} keeps the error encoding`).toBe(false);
      // %Error still crosses — through that OTHER representation, which is
      // the whole reason the hierarchy is held out of this one.
      const expected = cls === "%Error";
      expect(canConvertToDyn(obj(cls), noRec, noRec), `${cls} widens`).toBe(expected);
      expect(canDynCheckTo(obj(cls), noRec, noRec), `${cls} narrows`).toBe(expected);
    }
  });
});
