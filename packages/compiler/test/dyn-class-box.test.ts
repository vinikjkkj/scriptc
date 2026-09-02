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
import { canBoxClassIntoDyn, canConvertToDyn, canDynCheckTo, typeKey, RUNTIME_ERROR_CLASSES, RUNTIME_STREAM_CLASSES, RUNTIME_EMITTER_CLASS } from "../src/ir/nodes.js";
import type { IrRecordShape, IrType, IrUnionDef } from "../src/ir/nodes.js";

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
/** A parser that reads ZERO is the failure mode this file has already had,
 * and it is worse than having no test at all.
 *
 * When the instance MEMBER TABLE landed it widened ScrDynClass from six
 * fields to nine. Both regexes below stopped matching, both maps came back
 * empty, and the two parity tests failed as
 *
 *   expected [] to deeply equal [ 'Base', 'Derived', 'Lone', 'Readable' ]
 *
 * which READS as "the lanes disagree" but MEANT "nothing was checked" --
 * on precisely the change that needed checking, because the LLVM lane
 * spells %ScrDynClass as a literal struct and a C-side field added without
 * widening it hands the dyn core a short descriptor (measured once as
 * 0xC0000005).
 *
 * So every parser here refuses to come back empty when its anchor text is
 * in the unit. The next widening fails LOUDLY, as a parse error naming the
 * line it could not read, instead of quietly asserting nothing. */
function mustNotReadZero(kind: string, text: string, anchor: RegExp, size: number): void {
  if (size > 0) return;
  const hit = text.split("\n").find((l) => anchor.test(l));
  if (hit === undefined) return; // genuinely no descriptors in this unit
  throw new Error(
    `${kind}: this unit HAS descriptors but the parser matched none — the emitted ` +
      `shape changed and this test just went blind. Fix the regex to the shape ` +
      `actually emitted. First line it could not read:\n  ${hit.trim()}`,
  );
}

/** name:accessor:enumerable for each row, in EMITTED ORDER — order is a
 * parity fact too, since it is the order Object.keys answers in. */
function memberSummary(rows: readonly { name: string; get: boolean; enumerable: boolean }[]): string {
  return `[${rows.map((r) => `${r.name}:${r.get ? "get" : "call"}:${r.enumerable ? 1 : 0}`).join(",")}]`;
}

/** C member tables, keyed by their `sc_dclt_<n>` symbol.
 * `static const ScrDynClassMember sc_dclt_0[] = { /* members of Lone *\/`
 * then one `{ "v", 1, NULL, &sc_x, false },` per row. */
function cMemberTables(c: string): Map<string, string> {
  const out = new Map<string, string>();
  const re =
    /(?:static )?const ScrDynClassMember (sc_dclt_\d+)\[\] = \{ \/\* members of [^*]*\*\/\n([\s\S]*?)\n\};/g;
  for (const m of c.matchAll(re)) {
    const rows: { name: string; get: boolean; enumerable: boolean }[] = [];
    const ent = /\{ "([^"]*)", \d+, (NULL|&\w+), (NULL|&\w+), (true|false) \}/g;
    for (const e of m[2]!.matchAll(ent)) {
      rows.push({ name: e[1]!, get: e[2] !== "NULL", enumerable: e[4] === "true" });
    }
    out.set(m[1]!, memberSummary(rows));
  }
  return out;
}

/** LLVM member tables, same key. Names are cstr references, resolved
 * through the same pool the descriptor's display name comes from. */
function llMemberTables(ll: string, cstrs: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  const re = /@(sc_dclt_\d+) = internal constant \[\d+ x %ScrDynClassMember\] \[([\s\S]*?)\n\]/g;
  for (const m of ll.matchAll(re)) {
    const rows: { name: string; get: boolean; enumerable: boolean }[] = [];
    const ent =
      /%ScrDynClassMember \{ ptr @(sc_cs_\d+), i64 \d+, ptr (null|@[\w.]+), ptr (null|@[\w.]+), i8 ([01]) \}/g;
    for (const e of m[2]!.matchAll(ent)) {
      const nm = cstrs.get(e[1]!);
      if (nm === undefined) throw new Error(`llvm member row names an undefined cstr ${e[1]}`);
      rows.push({ name: nm, get: e[2] !== "null", enumerable: e[4] === "1" });
    }
    out.set(m[1]!, memberSummary(rows));
  }
  return out;
}

/** The cstr pool, shared by descriptor display names and member names. */
function llCstrs(ll: string): Map<string, string> {
  const cstrs = new Map<string, string>();
  for (const m of ll.matchAll(/^@(sc_cs_\d+) = internal constant \[\d+ x i8\] c"([^"]*)\\00"/gm)) {
    cstrs.set(m[1]!, m[2]!);
  }
  return cstrs;
}

const C_DESC_ANCHOR = /const ScrDynClass sc_dcl_\d+ = \{/;
const LL_DESC_ANCHOR = /^@sc_dcl_\d+ = internal constant %ScrDynClass \{/;

function cDescriptors(c: string): Map<string, string> {
  const out = new Map<string, string>();
  const tbls = cMemberTables(c);
  // The unit is emitted with `static ` linkage normally and bare when the
  // emitter is building a single merged TU (CEmitter.link), so the storage
  // class is optional here rather than assumed.
  // const ScrDynClass sc_dcl_0 = { "Lone", 5, 5, false, &r, &rl, sc_dclt_0, 1, false }; /* dyn box: class Lone */
  const re =
    /(?:static )?const ScrDynClass sc_dcl_\d+ = \{ "([^"]*)", (\d+), (\d+), (true|false), &(\w+), &(\w+), (NULL|\w+), (\d+), (true|false) \};/g;
  for (const m of c.matchAll(re)) {
    const mem = m[7] === "NULL" ? "[]" : (tbls.get(m[7]!) ?? `<missing table ${m[7]}>`);
    const declared = Number(m[8]);
    const actual = m[7] === "NULL" ? 0 : (mem.match(/:/g)?.length ?? 0) / 2;
    if (declared !== actual) {
      throw new Error(`c descriptor for ${m[1]} says nmembers=${declared} but its table holds ${actual}`);
    }
    out.set(
      m[1]!,
      `pre=${m[2]} post=${m[3]} vt=${m[4]} rc=${rcBase(m[5]!)}/${rcBase(m[6]!)} props=${m[9]} mem=${mem}`,
    );
  }
  mustNotReadZero("cDescriptors", c, C_DESC_ANCHOR, out.size);
  return out;
}

function llDescriptors(ll: string): Map<string, string> {
  const cstrs = llCstrs(ll);
  const tbls = llMemberTables(ll, cstrs);
  const out = new Map<string, string>();
  // @sc_dcl_0 = internal constant %ScrDynClass { ptr @sc_cs_3, i64 5, i64 5, i8 0, ptr @r, ptr @rl, ptr @sc_dclt_0, i64 1, i8 0 }
  const re =
    /^@sc_dcl_\d+ = internal constant %ScrDynClass \{ ptr @(sc_cs_\d+), i64 (\d+), i64 (\d+), i8 ([01]), ptr @(\w+), ptr @(\w+), ptr (null|@sc_dclt_\d+), i64 (\d+), i8 ([01]) \}/gm;
  for (const m of ll.matchAll(re)) {
    const name = cstrs.get(m[1]!);
    if (name === undefined) throw new Error(`llvm descriptor names an undefined cstr ${m[1]}`);
    const mem = m[7] === "null" ? "[]" : (tbls.get(m[7]!.slice(1)) ?? `<missing table ${m[7]}>`);
    const declared = Number(m[8]);
    const actual = m[7] === "null" ? 0 : (mem.match(/:/g)?.length ?? 0) / 2;
    if (declared !== actual) {
      throw new Error(`llvm descriptor for ${name} says nmembers=${declared} but its table holds ${actual}`);
    }
    out.set(
      name,
      `pre=${m[2]} post=${m[3]} vt=${m[4] === "1" ? "true" : "false"} ` +
        `rc=${rcBase(m[5]!)}/${rcBase(m[6]!)} props=${m[9] === "1" ? "true" : "false"} mem=${mem}`,
    );
  }
  mustNotReadZero("llDescriptors", ll, LL_DESC_ANCHOR, out.size);
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

/* ── the %Error LEAF, and the one thing that separates it from a record ──
 *
 * `canDynCheckTo` admits `%Error` STANDING ALONE and its own NESTED walker
 * answered `canBoxClassIntoDyn`, which is false for the whole error
 * hierarchy — so one IR type was checkable as the target and uncheckable as
 * a record FIELD, sixty lines apart in the same function. Meanwhile
 * `canConvertToDyn`'s record rule recurses with the FULL predicate, so the
 * field has ALWAYS converted IN. That asymmetry is the method-bundle
 * failure mode, and it is what fenced the `emit` trampoline: zapo's
 * `debug_client_error` carries `{ error: Error }`, one event out of
 * twenty-seven, and one declining event takes the whole dispatcher.
 *
 * The leaf is emittable because the error encoding is EXACT in both walkers:
 * dynCheck validates the reserved `"%error"` marker and extracts through the
 * runtime's identity cache, and dynMatch asks the SAME question. Those two
 * agreeing is what lets a union arm be matched here and built there.
 *
 * What this block pins is the part that would go quietly wrong: the encoding
 * is an ordinary SCR_DYN_OBJ, so a `{ name: string; message: string }`
 * RECORD matcher matches it too, and the only reasons a real Error does not
 * come back as that record are (a) the marker test above and (b) the
 * canonical arm order, which puts `object:%Error` before `record:*` because
 * unions intern their arms in typeKey order and 'o' < 'r'. Corpus 4642 is
 * the same statement as a running program.
 */
const ERROR_LEAF_PROGRAM = `
type Bag = { error: Error };
type OptBag = { error?: Error };
const e = new Error("boom");
const carried: unknown = { error: e };
const back = carried as Bag;
console.log(back.error.message, back.error === e);
const opt = carried as OptBag;
console.log(opt.error === undefined ? "none" : opt.error.message);
`;

async function compileErrorLeaf(): Promise<{ c: string; ll: string }> {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-errleaf-"));
  const src = join(dir, "main.ts");
  await writeFile(src, ERROR_LEAF_PROGRAM, "utf8");
  const out: Record<string, string> = {};
  for (const backend of ["c", "llvm"] as const) {
    const res = await compile(src, {
      outPath: join(dir, `program-${backend}`),
      outDir: dir,
      backend,
      emitOnly: true,
    });
    if (!res.ok) {
      throw new Error(`${backend} backend refused the error-leaf program: ${res.diagnostics[0]?.message ?? "?"}`);
    }
    out[backend] = await readFile(res.cPath, "utf8");
  }
  return { c: out.c!, ll: out.llvm! };
}

describe("an %Error leaf crosses nested, which is the shape the emit trampoline needs", () => {
  const noRec = (): undefined => undefined;
  const err: IrType = { kind: "object", className: "%Error" };
  const bagShape = {
    id: "rE",
    fields: [{ name: "error", type: err }],
  } as unknown as IrRecordShape;
  const optUnion = {
    id: "uE",
    arms: [err, { kind: "undefinedT" } as IrType],
  } as unknown as IrUnionDef;
  const optBagShape = {
    id: "rO",
    fields: [{ name: "error", type: { kind: "union", unionId: "uE" } as IrType }],
  } as unknown as IrRecordShape;
  const subShape = {
    id: "rT",
    fields: [{ name: "error", type: { kind: "object", className: "%TypeError" } as IrType }],
  } as unknown as IrRecordShape;
  const shapes = new Map<string, IrRecordShape>([
    ["rE", bagShape],
    ["rO", optBagShape],
    ["rT", subShape],
  ]);
  const unions = new Map<string, IrUnionDef>([["uE", optUnion]]);
  const getRecord = (id: string): IrRecordShape | undefined => shapes.get(id);
  const getUnion = (id: string): IrUnionDef | undefined => unions.get(id);
  const rec = (id: string): IrType => ({ kind: "record", shapeId: id });

  test("a record FIELD of type Error crosses in BOTH directions", () => {
    // IN was already true and is the half that made the asymmetry a
    // stranding rather than a symmetric refusal.
    expect(canConvertToDyn(rec("rE"), getRecord, getUnion), "{ error: Error } widens").toBe(true);
    expect(canDynCheckTo(rec("rE"), getRecord, getUnion), "{ error: Error } narrows").toBe(true);
  });

  test("an OPTIONAL error field crosses too — the arm that needs the MATCHER", () => {
    // `Error | undefined` is a union, so the union builder asks each arm's
    // matcher before it builds one. Without the %Error dynMatch arm this
    // shape reached `classMeta.get("%Error")` and threw an emitter bug —
    // a predicate that admits a leaf its walkers cannot emit trades a fence
    // for a crash.
    expect(canConvertToDyn(rec("rO"), getRecord, getUnion), "{ error?: Error } widens").toBe(true);
    expect(canDynCheckTo(rec("rO"), getRecord, getUnion), "{ error?: Error } narrows").toBe(true);
  });

  test("an array of errors crosses, and the ROOT only — subclasses stay out", () => {
    const arr: IrType = { kind: "array", elem: err };
    expect(canConvertToDyn(arr, getRecord, getUnion), "Error[] widens").toBe(true);
    expect(canDynCheckTo(arr, getRecord, getUnion), "Error[] narrows").toBe(true);
    // %TypeError and the rest keep declining, nested as standing alone, and
    // the reason is exactness: the encoding records a `name` STRING, not a
    // class interval, so a dyn error validated into a `%TypeError` slot
    // would answer that slot for every error there is. Only the root is a
    // test the encoding can actually pass or fail.
    for (const cls of RUNTIME_ERROR_CLASSES.keys()) {
      if (cls === "%Error") continue;
      const nested: IrType = { kind: "array", elem: { kind: "object", className: cls } };
      expect(canConvertToDyn(nested, getRecord, getUnion), `${cls}[] widens`).toBe(false);
      expect(canDynCheckTo(nested, getRecord, getUnion), `${cls}[] narrows`).toBe(false);
    }
    expect(canDynCheckTo(rec("rT"), getRecord, getUnion), "{ error: TypeError } narrows").toBe(false);
  });

  test("an %Error arm is TRIED BEFORE any record arm, by the canonical order", () => {
    // Unions intern their arms in typeKey order (frontend/types.ts's
    // `arms.sort((a, b) => (typeKey(a) < typeKey(b) ? -1 : 1))`), and a
    // record matcher for { name: string; message: string } matches the
    // error encoding exactly — same kind, both fields present, both
    // strings. Order is what resolves the overlap, and this is the
    // assertion that fails if the key scheme ever stops resolving it in the
    // correct direction. It is a property of the KEYS, not of one program:
    // "object:%Error" < "record:" for every record id there can be.
    expect(typeKey(err)).toBe("object:%Error");
    expect(typeKey(err) < typeKey({ kind: "record", shapeId: "r0" })).toBe(true);
    expect(typeKey(err) < typeKey({ kind: "record", shapeId: "" })).toBe(true);
  });

  test("both backends match an %Error by the ENCODING PREDICATE, not by a class interval", async () => {
    const { c, ll } = await compileErrorLeaf();
    // C: the union ARM WALKER is where this question is asked now. The C
    // lane merged the match predicate into the checked builder — one
    // function that decides while it builds — so there is no separate
    // sc_dm_ for an arm to consult, and the assertion moved onto the
    // walker that replaced it. What is pinned is unchanged in substance:
    // the ERROR ENCODING, never a class interval, and a miss that is SOFT
    // (the union tries the next arm) rather than a refusal.
    //
    // The SPELLING changed, and that is the point of the rename in this
    // test's title. It used to be `scr_dyn_obj_get(d, "%error", 6)` — a
    // lookup of a compiler-reserved KEY, open-coded here, in the checked
    // builder, and twice more in the LLVM lane. A key cannot answer the
    // question in either direction: "%" is legal in a JS property name, so
    // a user's own "%error" key passed the test, and the marker it looked
    // for was an own ENUMERABLE property of every error the program could
    // enumerate (Object.keys answered ["%error","name","message"] where
    // Node answers []). One runtime predicate over the [[Prototype]] chain
    // replaced all four copies, which is also why the two lanes below can
    // be checked for the SAME symbol rather than for two spellings.
    const cm =
      /(sc_da_\d+)\(const ScrDyn \*d, const ScrDynPath \*path, bool \*ok\) \{ \/\* arm object:%Error \*\/\n([\s\S]*?)\n\}/.exec(
        c,
      );
    expect(cm, "no C arm walker for object:%Error — this test has gone blind").not.toBeNull();
    expect(cm![2]).toContain(`scr_dyn_is_error_encoding(d)`);
    expect(cm![2]).not.toContain(`"%error"`);
    expect(cm![2]).not.toContain("scr_dyn_objinst_is");
    expect(cm![2]).toContain("*ok = false");
    // LLVM: same question, same answer, and now the same runtime call — and
    // that lane carries the SAME merged walker, so this half asks the arm
    // walker too. Before the LLVM twin landed it read the sc_dm_ matcher,
    // which is the shape the C lane had before ITS merge; the pin is
    // unchanged.
    const lm =
      /define internal ptr @sc_da_\d+\(ptr %d, ptr %path, ptr %ok\) #\d+ \{ ; arm object:%Error\n([\s\S]*?)\n\}/.exec(
        ll,
      );
    expect(lm, "no LLVM arm walker for object:%Error — this test has gone blind").not.toBeNull();
    expect(lm![1]).toContain("@scr_dyn_is_error_encoding");
    expect(lm![1]).not.toContain("scr_dyn_objinst_is");
    expect(lm![1]).toContain("store i1 false, ptr %ok");
    // And the C lane's CHECKED builder asks the identical question, in the
    // identical spelling, so a direct `u as Error` cannot disagree with an
    // arm about what an %Error is.
    expect(c).toContain(`if (!scr_dyn_is_error_encoding(d))`);
    // Neither lane may reach for the reserved key ANYWHERE in an emitted
    // unit: the emitted copies are what drifted from the runtime before,
    // and one grep is what keeps a fifth copy from being added.
    expect(c).not.toContain(`"%error"`);
    expect(ll).not.toContain(`%error`);
  });
});
