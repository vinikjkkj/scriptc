/* The shared abort helpers, and the guards that call them.
 *
 * Every structural abort the C backend plants used to open-code its message:
 * `if (!o) { scr_trap("scriptc: out of memory\n"); }` after each raw
 * allocation, `default: scr_trap("scriptc: internal error: invalid union
 * tag\n");` under each `switch (v->tag)`. The LLVM backend has always emitted
 * ONE definition per message and called it (llvm/emitter.ts helperDefs), so a
 * census that counts trap STATEMENTS measured the emitter and not the
 * program: the same corpus programs read 0 / 8 / 9 / 35 through the C backend
 * and 2 through the LLVM one. The C backend now plants the same helpers.
 *
 * The hazard this file exists for is the opposite of a missing helper: a
 * collapse that quietly drops a GUARD. Every one of those guards is load
 * bearing — the statement after an allocation guard dereferences the pointer,
 * and a union-tag default is what keeps a corrupt tag loud instead of
 * undefined behaviour — so the assertions below are about the CALL SITES
 * first and the definitions second:
 *
 *  1. one definition per message, and none of the message text left inline;
 *  2. every raw allocation in the TU still has its guard, and every guard
 *     still has its allocation — the unit that must not move;
 *  3. the C guard-site count equals the LLVM call-site count, so the two
 *     backends agree on how many places can abort;
 *  4. the two backends' message bytes are the same bytes.
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "../src/index.js";

/* Record shapes and classes (the calloc guards), an async function and a
 * generator (the malloc guards), and unions read through truthiness, `===`,
 * `String()`, `JSON.stringify`, an `unknown` box and a discriminated field
 * (the tag defaults). Every family the emitter can plant, in one program. */
const PROGRAM = [
  `type Pt = { x: number; y: number };`,
  `type Seg = { a: Pt; b: Pt; label: string };`,
  `class Node2 { name: string; constructor(n: string) { this.name = n; } d(): string { return "n:" + this.name; } }`,
  `class Leaf extends Node2 { w: number; constructor(n: string, w: number) { super(n); this.w = w; } d(): string { return "l:" + this.name; } }`,
  `type Val = string | number | boolean | null;`,
  `type Circle = { kind: "circle"; r: number; id: string };`,
  `type Rect = { kind: "rect"; w: number; h: number; id: string };`,
  `type Shape = Circle | Rect;`,
  `type Opt = { kept: string; maybe: string | undefined };`,
  `function pt(x: number, y: number): Pt { return { x, y }; }`,
  `function seg(a: Pt, b: Pt, label: string): Seg { return { a, b, label }; }`,
  `function carry(v: unknown): unknown { return v; }`,
  `function area(s: Shape): number { return s.kind === "circle" ? 3 * s.r * s.r : s.w * s.h; }`,
  `async function widen(s: Shape): Promise<string> { return s.id + String(await Promise.resolve(area(s))); }`,
  `function* walk(xs: Shape[]): Generator<string> { for (const s of xs) yield s.id; }`,
  `const vals: Val[] = ["x", "", 7, 0, true, false, null];`,
  `const shapes: Shape[] = [{ kind: "circle", r: 2, id: "c" }, { kind: "rect", w: 3, h: 4, id: "r" }];`,
  `const opts: Opt[] = [{ kept: "a", maybe: "m" }, { kept: "b", maybe: undefined }];`,
  `const s1 = seg(pt(0, 0), pt(1, 1), "d");`,
  `const ns: Node2[] = [new Node2("a"), new Leaf("b", 1)];`,
  `async function main(): Promise<void> {`,
  `  console.log(s1.label, ns.map((n) => n.d()).join("|"));`,
  `  console.log(vals.map((v) => (v ? "t" : "f")).join(""), vals[0] === vals[2]);`,
  `  console.log(vals.map((v) => String(v)).join(","), JSON.stringify({ vals }), JSON.stringify(opts));`,
  `  console.log(vals.map((v) => String(carry(v))).join(","));`,
  `  console.log(shapes.map((s) => s.id).join(","), String(area(shapes[0]!)));`,
  `  console.log(await widen(shapes[1]!));`,
  `  const w: string[] = [];`,
  `  for (const id of walk(shapes)) w.push(id);`,
  `  console.log(w.join(","));`,
  `}`,
  `await main();`,
  `export {};`,
  ``,
].join("\n");

/** The three families, spelled the way the emitted C spells them: `msg` is
 * the C source text of the message, backslash-n and all. */
const FAMILIES = [
  { helper: "sc_oom", msg: "scriptc: out of memory\\n", llMsg: "sc_oom_msg" },
  {
    helper: "sc_bad_tag",
    msg: "scriptc: internal error: invalid union tag\\n",
    llMsg: "sc_bad_tag_msg",
  },
  {
    helper: "sc_stringify_undef",
    msg: "scriptc: internal error: stringify reached an undefined arm\\n",
    llMsg: null,
  },
] as const;

let both: Promise<{ c: string; ll: string }> | undefined;
function compileBoth(): Promise<{ c: string; ll: string }> {
  return (both ??= (async () => {
    const dir = await mkdtemp(join(tmpdir(), "scriptc-sharedtrap-"));
    const out: Record<string, string> = {};
    for (const backend of ["c", "llvm"] as const) {
      const src = join(dir, `main-${backend}.ts`);
      await writeFile(src, PROGRAM, "utf8");
      const res = await compile(src, {
        outPath: join(dir, `program-${backend}`),
        outDir: dir,
        backend,
        emitOnly: true,
      });
      if (!res.ok) {
        throw new Error(
          `${backend} backend refused the guard program: ${res.diagnostics[0]?.message ?? "?"}`,
        );
      }
      out[backend] = await readFile(res.cPath, "utf8");
    }
    return { c: out.c!, ll: out.llvm! };
  })());
}

const OOM_SITE = /^\s*if\s*\(![A-Za-z_][A-Za-z0-9_]*\)\s*\{\s*sc_oom\(\);\s*\}/;
const RAW_ALLOC = /\b(?:calloc|malloc|realloc)\s*\(/;

/** Statement-level split of an emitted C TU: the raw allocations, the guard
 * sites that call each helper, and the definition line of each helper. The
 * rules are the emitted TU's own shape — a definition opens at column 0, a
 * statement is indented — and nothing here reads the emitter's source. */
function readGuards(c: string): {
  lines: string[];
  allocs: number[];
  oomSites: number[];
  tagSites: number[];
  strSites: number[];
  defLine: Map<string, number>;
  msgCount: Map<string, number>;
} {
  const lines = c.split("\n");
  const allocs: number[] = [];
  const oomSites: number[] = [];
  const tagSites: number[] = [];
  const strSites: number[] = [];
  const defLine = new Map<string, number>();
  const msgCount = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    for (const f of FAMILIES) {
      if (l.startsWith(`static _Noreturn void ${f.helper}(void) {`)) defLine.set(f.helper, i);
    }
    if (RAW_ALLOC.test(l) && !l.includes("scr_trap")) allocs.push(i);
    if (OOM_SITE.test(l)) oomSites.push(i);
    if (/^\s*default:\s*sc_bad_tag\(\);/.test(l)) tagSites.push(i);
    if (/^\s*sc_stringify_undef\(\);/.test(l)) strSites.push(i);
  }
  for (const f of FAMILIES) {
    msgCount.set(f.helper, c.split(`scr_trap("${f.msg}")`).length - 1);
  }
  return { lines, allocs, oomSites, tagSites, strSites, defLine, msgCount };
}

describe("the shared abort helpers", () => {
  test("the program plants all three families, so the assertions below are not vacuous", async () => {
    const { c, ll } = await compileBoth();
    const g = readGuards(c);
    expect(g.oomSites.length, "no OOM guard site in the TU").toBeGreaterThan(0);
    expect(g.tagSites.length, "no union-tag default in the TU").toBeGreaterThan(0);
    expect(g.strSites.length, "no stringify-undefined arm in the TU").toBeGreaterThan(0);
    expect(ll).toContain("define internal void @sc_oom()");
    expect(ll).toContain("define internal void @sc_bad_tag()");
  });

  test("each message is emitted ONCE, inside its helper, above every call site", async () => {
    const { c } = await compileBoth();
    const g = readGuards(c);
    for (const f of FAMILIES) {
      expect(g.msgCount.get(f.helper), `${f.helper}: message text emitted more than once`).toBe(1);
      const def = g.defLine.get(f.helper);
      expect(def, `${f.helper}: no helper definition`).toBeDefined();
      expect(g.lines[def! + 1]).toBe(`  scr_trap("${f.msg}");`);
      expect(g.lines[def! + 2]).toBe("}");
    }
    const firstSite = Math.min(...g.oomSites, ...g.tagSites, ...g.strSites);
    for (const f of FAMILIES) {
      expect(
        g.defLine.get(f.helper)!,
        `${f.helper} is defined below its first call site`,
      ).toBeLessThan(firstSite);
    }
  });

  test("no guard was dropped: every raw allocation is guarded and every guard has its allocation", async () => {
    const { c } = await compileBoth();
    const g = readGuards(c);
    // Direction 1 — an allocation with no guard is a NULL dereference on the
    // next statement, which is the failure this collapse must not introduce.
    const unguarded = g.allocs.filter((i) => !OOM_SITE.test(g.lines[i + 1] ?? ""));
    expect(
      unguarded.map((i) => g.lines[i]!.trim()),
      "raw allocation with no OOM guard on the next line",
    ).toEqual([]);
    // Direction 2 — a guard with no allocation behind it would mean the
    // collapse moved a guard away from what it guards.
    const stray = g.oomSites.filter((i) => !RAW_ALLOC.test(g.lines[i - 1] ?? ""));
    expect(
      stray.map((i) => g.lines[i]!.trim()),
      "OOM guard with no allocation on the previous line",
    ).toEqual([]);
    expect(g.oomSites.length).toBe(g.allocs.length);
  });

  test("the two backends agree on how many places can abort", async () => {
    const { c, ll } = await compileBoth();
    const g = readGuards(c);
    const llOom = (ll.match(/call void @sc_oom\(\)/g) ?? []).length;

    /* EACH LANE LOSES ONE OOM SITE PER FUNCTION *IT* CONVERTS, SO THE TWO
     * GUARD COUNTS PLUS THE TWO CONVERSION COUNTS ARE THE SAME NUMBER.
     *
     * Plain equality was true only while nothing converted. A converted
     * function becomes a state machine: the fiber trampoline's malloc guard
     * disappears and scr_coro_alloc plants none in the TU, so the lane that
     * converts it is one guard shorter. That much has not changed.
     *
     * WHAT CHANGED, AND WHY THE OLD SUBTRACTION STOPPED BEING TRUE. This
     * assertion used to subtract the C lane's conversion count alone, on the
     * premise that `LLVM has no stackless lowering and loses none`. The LLVM
     * backend now HAS one -- and lowers a STRICT SUBSET of the shared plan
     * (llvm/emitter.ts: coroPlans is the backend-agnostic policy,
     * llvmCoroPlans narrows it, and a refusal at emission removes the entry
     * again). A generator is a NAMED refusal reason there, not an oversight:
     * on this very program `SCRIPTC_LLVM_CORO_CENSUS=1 SCRIPTC_NO_CACHE=1`
     * prints `2 lowered of 3 planned` with `refuse walk generator`, while
     * the C lane converts all three.
     *
     * MEASURED, at three points, on this program and on a variant of it:
     *   knob-off          C oom 14, LL oom 14, converted 0 / 0
     *   knob-on           C oom 11, LL oom 12, converted 3 / 2
     *   knob-on, +1 gen   C oom 11, LL oom 13, converted 4 / 2
     * The third is a variant built to move BOTH sides at once (a second
     * synchronous generator, which C converts and LLVM refuses); two points
     * cannot separate this relation from the one it replaces, and that one
     * fits the first two just as well.
     *
     * BOTH COUNTS ARE DERIVED FROM THE ARTIFACT each lane produced, neither
     * is passed in and neither is hardcoded -- so no number here is one the
     * test made up and then verified.
     *
     * AND THIS FORM NEEDS NO FUTURE EDIT, which is the point of writing it
     * as a sum rather than as a correction. The note this replaces said to
     * delete the subtraction once LLVM grew the lowering. It has grown one,
     * and the right answer was not deletion: convergence is PARTIAL and may
     * stay that way. When the two lanes do converge the two conversion
     * counts become equal on their own and this reduces to the original
     * plain equality with nothing to remove. A non-zero gap between the
     * counts is a report about which shapes each lane lowers, and belongs to
     * the census -- not to this assertion. */
    const cConverted = (c.match(/void sc_cr_[A-Za-z0-9_]+\(ScrCoroBase \*sc_b\)\s*\{/g) ?? []).length;
    const llConverted = (ll.match(/^define[^\n]*@sc_cr_[A-Za-z0-9_]+\(/gm) ?? []).length;
    expect(
      g.oomSites.length + cConverted,
      `C OOM guard sites (${g.oomSites.length}) plus C conversions (${cConverted}) must equal ` +
        `LLVM @sc_oom (${llOom}) plus LLVM conversions (${llConverted}): each lane loses exactly ` +
        `one guard per function IT converts, and the lanes lower different subsets of the same ` +
        `plan (LLVM refuses generators). Knob-off both conversion counts are 0 and this is the ` +
        `plain equality.`,
    ).toBe(llOom + llConverted);
    // THE ARMING, because the equality above is satisfied by 0 + 0 == 0 + 0.
    // A program that converted nothing -- the knob lost on the way to one of
    // the backends, a refusal widened until it swallowed the whole plan --
    // would pass it while guarding nothing, and the conversion counts are
    // exactly what makes that case invisible.
    //
    // BOTH ARMS ARE ASSERTED, not one asserted and one skipped. Under the
    // opt-out the right expectation is not "no expectation": it is that
    // NEITHER lane converted, which is the claim that makes the equality
    // above reduce to the plain one. This file does not pin the knob itself
    // -- compileBoth is shared by all five tests and reads the ambient
    // setting -- so a whole-gate run under SCRIPTC_STACKLESS=0 lands here
    // legitimately and must be guarded, not excused.
    expect(llOom, "the LLVM lane emitted no OOM call at all").toBeGreaterThan(0);
    if (process.env["SCRIPTC_STACKLESS"] === "0") {
      expect([cConverted, llConverted], "the opt-out must convert nothing on either lane")
        .toEqual([0, 0]);
    } else {
      // This program has an async function, a generator and an async entry;
      // the C lane lowers all three.
      expect(cConverted, "the C lane converted nothing -- the knob did not reach this emitter")
        .toBeGreaterThan(0);
    }
    // The tag defaults are NOT expected to match one for one: the LLVM lane
    // routes a few more paths through @sc_bad_tag than C spells as a switch
    // default (measured: +2 on every program that has any). What must hold is
    // that neither lane lost the family.
    const llTag = (ll.match(/call void @sc_bad_tag\(\)/g) ?? []).length;
    expect(llTag).toBeGreaterThanOrEqual(g.tagSites.length);
  });

  test("the two backends' message bytes are the same bytes", async () => {
    const { c, ll } = await compileBoth();
    expect(c).toContain("static _Noreturn void sc_oom(void) {");
    for (const f of FAMILIES) {
      if (f.llMsg === null) continue;
      const m = new RegExp(`@${f.llMsg} = internal constant \\[\\d+ x i8\\] c"([^"]*)"`).exec(ll);
      expect(m, `${f.llMsg} not found in the .ll`).not.toBeNull();
      // LLVM escapes the message with \XX hex pairs; C with \n. Normalise the
      // LLVM spelling to the C one and compare the text itself.
      const llText = m![1]!.replace(/\\0A/g, "\\n").replace(/\\00$/, "");
      expect(llText, `${f.helper}: the two backends print different bytes`).toBe(f.msg);
    }
  });
});
