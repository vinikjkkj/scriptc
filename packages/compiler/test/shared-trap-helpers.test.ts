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
    expect(llOom, "C OOM guard sites != LLVM @sc_oom call sites").toBe(g.oomSites.length);
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
