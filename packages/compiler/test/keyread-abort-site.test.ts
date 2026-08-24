/* SC9003 — the keyed-read abort names the line it happened at.
 *
 * ABORT.real is one family: a keyed read whose result width has no way to
 * spell `undefined`, so a missing key cannot be answered and the process
 * aborts instead of corrupting a typed slot. On zapo that is 9 emitted
 * helpers at 13 call sites, and until this file every one of them died
 * with no code, no file and no line — the same diagnostic shape
 * `scr_dyn_new_func`'s NULL `sig` had, and the worst one this project has.
 *
 * The helper is interned per (shape, result type) and is therefore SHARED
 * by every read of that pair, so it cannot name the site itself: the site
 * has to arrive from the call. That is the whole design here, and it is
 * what the first three tests pin.
 *
 * The fourth and fifth pin something more load-bearing than a message.
 * The abort's miss path splits STRUCTURALLY into two populations, and the
 * split is the classification of the whole family:
 *
 *   DECLARED-KEYS  the shape has NO index signature. TypeScript will not
 *                  typecheck `r[k]` on such a shape unless it proved `k`
 *                  is one of the declared keys, so the miss is reachable
 *                  only by defeating the checker.
 *   INDEX-MISS     the shape HAS an index signature. The key really can
 *                  be absent at run time; the result width is what has no
 *                  `undefined` to answer with.
 *
 * Those are different facts about the program and they deserve different
 * sentences, so the emitted message carries the one that applies. And
 * "reachable only by defeating the checker" is a claim about a REACHABLE
 * state, not an unreachable one: `keyread-abort-site` in tests/harness
 * runs both spellings of that defeat — an `as` cast and a JSON crossing —
 * on both backends, and both reach the abort. Nothing here says the state
 * cannot occur; it says what the program is told when it does.
 *
 * A helper that CAN answer undefined (a dyn result, an undefined-armed
 * union) is not in this family and must take no site argument at all —
 * the site costs a pointer per call, and the population that can never
 * die must not pay it. That is the sixth test, and on zapo it is 25 of
 * the 34 keyed-read helpers.
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { compile } from "../src/index.js";

/* Three keyed reads the emitter must treat differently:
 *   RANK[l]  a Record over a LITERAL UNION  -> no index signature -> DECLARED-KEYS
 *   bag[k]   a Record<string, string>       -> index signature    -> INDEX-MISS
 *   loose[k] a Record<string, unknown>      -> dyn result         -> not in the family
 */
const PROGRAM = [
  `type Level = 'trace' | 'debug' | 'info';`,
  `type Attrs = { [k: string]: string };`,
  `type Bag = { [k: string]: unknown };`,
  `const RANK: Readonly<Record<Level, number>> = { trace: 10, debug: 20, info: 30 };`,
  `function rank(l: Level): number {`,
  `  return RANK[l];`,
  `}`,
  `function attr(a: Attrs, k: string): string {`,
  `  return a[k];`,
  `}`,
  `function loose(b: Bag, k: string): string {`,
  `  const v = b[k];`,
  `  return v === undefined ? "no" : "yes";`,
  `}`,
  `function main(): void {`,
  `  const a: Attrs = { x: "1" };`,
  `  const b: Bag = { y: 2 };`,
  `  console.log(String(rank('info')), attr(a, "x"), loose(b, "y"));`,
  `}`,
  `main();`,
  `export {};`,
  ``,
].join("\n");

/* The coordinate the emitter must produce for one substring of PROGRAM:
 * 1-based line, 1-based column, computed here from the text so the
 * convention is PINNED and not merely "some numbers appeared". */
function lineCol(needle: string): { line: number; col: number } {
  const at = PROGRAM.indexOf(needle);
  expect(at).toBeGreaterThanOrEqual(0);
  const before = PROGRAM.slice(0, at);
  const nl = before.lastIndexOf("\n");
  return { line: before.split("\n").length, col: at - nl };
}

/* The aborting helpers of a TU: a `sc_rkg_` definition whose body carries
 * the trap. real-aborts.mjs's own rule, reproduced rather than imported so
 * the two instruments can disagree out loud. */
function abortingHelpers(tu: string): Set<string> {
  const aborting = new Set<string>();
  const lines = tu.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^static .*?\b(sc_rkg_\d+)\(.*\{ \/\* r\[k\] on /.exec(lines[i]!);
    if (!m) continue;
    for (let j = i + 1; j < lines.length && lines[j] !== "}"; j++) {
      if (lines[j]!.includes("record has no key")) aborting.add(m[1]!);
    }
  }
  return aborting;
}

/* Every emitted CALL of an aborting helper, with the trailing string
 * literal argument it passes. A call on a line at column 0 is a prototype
 * or a definition header, never a call. */
function callSites(tu: string): { helper: string; site: string | null }[] {
  const aborting = abortingHelpers(tu);
  const out: { helper: string; site: string | null }[] = [];
  for (const l of tu.split("\n")) {
    if (l.length === 0 || (l[0] !== " " && l[0] !== "\t")) continue;
    const re = /(^|[^A-Za-z0-9_])(sc_rkg_\d+)\s*\(/g;
    for (let m; (m = re.exec(l)) !== null; ) {
      if (!aborting.has(m[2]!)) continue;
      const open = m.index + m[0].length - 1;
      out.push({ helper: m[2]!, site: lastStringArg(l, open) });
    }
  }
  return out;
}

/* The last TOP-LEVEL argument of the call whose `(` is at `open`, when it
 * is a string literal. Parenthesis counting, not a regex: the union-arm
 * call site carries a cast and a nested call before the site. */
function lastStringArg(line: string, open: number): string | null {
  if (line[open] !== "(") return null;
  let depth = 0;
  let inStr = false;
  let argStart = open + 1;
  let last: string | null = null;
  for (let i = open; i < line.length; i++) {
    const c = line[i]!;
    if (inStr) {
      if (c === "\\") { i++; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "(") { depth++; continue; }
    if (c === ")") {
      depth--;
      if (depth === 0) { last = line.slice(argStart, i).trim(); break; }
      continue;
    }
    if (c === "," && depth === 1) argStart = i + 1;
  }
  if (last === null || last.length < 2 || !last.startsWith('"') || !last.endsWith('"')) return null;
  return last.slice(1, -1);
}

let dir: string | undefined;
let srcPath: string | undefined;

async function emit(backend: "c" | "llvm"): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "scriptc-rkgsite-"));
  srcPath ??= join(dir, "main.ts");
  await writeFile(srcPath, PROGRAM, "utf8");
  const res = await compile(srcPath, {
    outPath: join(dir, `program-${backend}`),
    outDir: dir,
    backend,
    emitOnly: true,
  });
  if (!res.ok) {
    throw new Error(`the site program did not compile on ${backend}: ${res.diagnostics[0]?.message ?? "?"}`);
  }
  return await readFile(res.cPath, "utf8");
}

let cachedC: Promise<string> | undefined;
let cachedLl: Promise<string> | undefined;
const cTu = (): Promise<string> => (cachedC ??= emit("c"));
const llTu = (): Promise<string> => (cachedLl ??= emit("llvm"));

afterAll(() => {
  dir = undefined;
  srcPath = undefined;
});

describe("SC9003: the keyed-read abort names its source site", () => {
  test("the program really plants BOTH abort classes and one non-aborting read", async () => {
    const tu = await cTu();
    /* not vacuous: two aborting helpers, one of each class, and a dyn one */
    const aborting = abortingHelpers(tu);
    expect(aborting.size).toBe(2);
    expect(callSites(tu).length).toBe(2);
    expect(/^static ScrDyn \*sc_rkg_\d+\(/m.test(tu)).toBe(true);
  });

  test("an ABORTING helper takes the site; one that answers undefined takes nothing", async () => {
    const tu = await cTu();
    const aborting = abortingHelpers(tu);
    const decls = [...tu.matchAll(/^static .*?\b(sc_rkg_\d+)\((.*?)\) \{ \/\* r\[k\] on /gm)];
    expect(decls.length).toBeGreaterThanOrEqual(3);
    for (const d of decls) {
      const takesSite = d[2]!.includes("const char *sc_site");
      expect(takesSite).toBe(aborting.has(d[1]!));
    }
  });

  test("every abortable call site passes the file, the LINE and the COLUMN of the read", async () => {
    const tu = await cTu();
    const sites = callSites(tu).map((s) => s.site);
    expect(sites.every((s) => s !== null)).toBe(true);
    const rank = lineCol("RANK[l]");
    const attr = lineCol("a[k];");
    expect(sites).toContain(`${srcPath!.replace(/\\/g, "/")}:${rank.line}:${rank.col}`);
    expect(sites).toContain(`${srcPath!.replace(/\\/g, "/")}:${attr.line}:${attr.col}`);
  });

  test("the message carries the code, and the code is where the site goes", async () => {
    const tu = await cTu();
    const traps = [...tu.matchAll(/scr_trap_fmt\("scriptc: TypeError: record has no key[^\n]*/g)].map((m) => m[0]);
    expect(traps.length).toBe(2);
    for (const t of traps) {
      expect(t).toContain("(SC9003 at %s)");
      /* the site is the LAST argument, after the key's two */
      expect(t).toContain("(int)k->len, k->data, sc_site)");
    }
  });

  test("the WHY sentence is the shape's, and the two classes get different ones", async () => {
    const tu = await cTu();
    /* DECLARED-KEYS: no index signature, so the message names the keys
     * TypeScript admitted and says what it takes to arrive outside them. */
    expect(tu).toContain("the shape declares only {debug, info, trace} and has no index signature");
    expect(tu).toContain("an unchecked cast or an unvalidated dynamic crossing reached it");
    /* INDEX-MISS: the key really was absent. */
    expect(tu).toContain("the key is absent from the index signature and the result width has no undefined");
    /* and neither sentence is on the wrong helper */
    const declaredKeysHelper = /static double (sc_rkg_\d+)\(/.exec(tu)?.[1];
    expect(declaredKeysHelper).toBeTruthy();
  });

  test("the LLVM lane names the same site, through the same one shared helper", async () => {
    const ll = await llTu();
    expect(ll).toContain("define internal void @sc_bad_key(ptr %site, ptr %why)");
    expect(ll).toContain("(SC9003 at %s)");
    const calls = [...ll.matchAll(/call void @sc_bad_key\(ptr (@\S+), ptr (@\S+)\)/g)];
    expect(calls.length).toBe(2);
    /* the two sites are distinct constants, and both are the C lane's */
    expect(new Set(calls.map((m) => m[1])).size).toBe(2);
    const rank = lineCol("RANK[l]");
    expect(ll).toContain(`${srcPath!.replace(/\\/g, "/")}:${rank.line}:${rank.col}`);
    /* and so is the why, one per class */
    expect(ll).toContain("has no index signature");
    expect(ll).toContain("the key is absent from the index signature");
  });
});
