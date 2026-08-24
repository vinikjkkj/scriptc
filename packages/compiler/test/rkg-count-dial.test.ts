/* SCRIPTC_RKG_COUNT=1 — the runtime execution counter for the keyed-read
 * ABORT family (ABORT.real), and the twin of SCRIPTC_DC_COUNT.
 *
 * `scripts/real-aborts.mjs` reads an emitted TU and says how many CALL SITES
 * of an aborting `sc_rkg_` helper it contains (51 on zapo at 8176c4a1) and
 * which source function hosts each. Nothing could say which of them a run
 * ever REACHES — and the answer is not the DYNCHECK answer, because this
 * family's miss path is a process abort: "it never fired" is true of every
 * site on every healthy run and says nothing at all. Which sites the program
 * actually WALKS is the ordering that decides what matters.
 *
 * The hazards this file exists for, in the order they would bite:
 *
 *  1. A PROBE IS NOT FREE. A guard added with probeLower once interned an
 *     extra helper into zapo's TU, caught only by diffing two 129 MB files.
 *     With the dial off this emitter must add NOTHING, asserted as the
 *     absence of every one of its spellings from the whole TU.
 *  2. The counted population must be the ABORTING one. A keyed-read helper
 *     that can answer `undefined` (a dyn result, an undefined-armed union)
 *     is not in ABORT.real, and counting its call sites would inflate the
 *     denominator the reachability fraction is read against.
 *  3. The unit must be the CALL SITE and not the statement. The statement
 *     count read 24 on both sides of a fix that took a paired zapo from
 *     crash to clean exit; `real-aborts.mjs` counts call sites, and these
 *     ordinals must be in 1:1 correspondence with ITS number — which is why
 *     that unit is reproduced below rather than assumed.
 *  4. The ordinals must be dense and unique, or the emitted array is indexed
 *     out of range, or leaves holes that read as "never executed".
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { compile } from "../src/index.js";

/* Keyed reads the emitter must treat differently:
 *   - `a[k]` at `string` in a RETURN slot        ABORTS
 *   - `n[k]` at `number` in a RETURN slot        ABORTS — a SECOND aborting
 *                                                shape, so the dial still
 *                                                has two ordinals to keep
 *                                                dense and unique
 *   - `a[k].length`                              a MEMBER RECEIVER, and no
 *                                                longer in ABORT.real: it
 *                                                takes the undefined arm and
 *                                                throws Node's own receiver
 *                                                TypeError rather than
 *                                                aborting the process past
 *                                                the program's own catch
 *                                                (keyedReadAtMemberReceiver,
 *                                                lower-exprs.ts). It stays in
 *                                                the fixture as a second
 *                                                helper that can answer
 *                                                undefined and must NOT be
 *                                                counted.
 *   - `b[k]` at `unknown` (dyn)                  ANSWERS undefined — not counted
 * plus a literal-key read that lowers to a plain field access and must never
 * appear here at all. */
const PROGRAM = [
  `type Attrs = { [k: string]: string };`,
  `type Bag = { [k: string]: unknown };`,
  `type Nums = { [k: string]: number };`,
  `function pick(a: Attrs, k: string): string {`,
  `  return a[k];`,
  `}`,
  `function pickNum(n: Nums, k: string): number {`,
  `  return n[k];`,
  `}`,
  `function pickLen(a: Attrs, k: string): number {`,
  `  return a[k].length;`,
  `}`,
  `function pickTwice(a: Attrs, k: string): string {`,
  `  return a[k] + a["lit"];`,
  `}`,
  `function loose(b: Bag, k: string): string {`,
  `  const v = b[k];`,
  `  return v === undefined ? "no" : "yes";`,
  `}`,
  `function main(): void {`,
  `  const a: Attrs = { x: "1", lit: "2" };`,
  `  const b: Bag = { y: 2 };`,
  `  const n: Nums = { z: 3 };`,
  `  console.log(pick(a, "x"), pickNum(n, "z"), pickLen(a, "x"), pickTwice(a, "x"), loose(b, "y"));`,
  `}`,
  `main();`,
  `export {};`,
  ``,
].join("\n");

const TRAP = /record has no key/g;
const HIT = /\bSC_RK_HIT\((\d+)\)/g;
const SITE = /\/\*RKSITE k=(\d+) h=(sc_rkg_\d+) s=(\S+) t=(\S+)\*\//g;

/* real-aborts.mjs's own call-site unit, reproduced here rather than imported
 * so the two instruments can disagree out loud: a call on an INDENTED line
 * (a line at column 0 is the prototype or the definition header), counted
 * only for helpers whose body carries the trap. */
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
function abortableCallSites(tu: string): number {
  const aborting = abortingHelpers(tu);
  let n = 0;
  for (const l of tu.split("\n")) {
    if (l.length === 0 || (l[0] !== " " && l[0] !== "\t")) continue;
    const re = /(^|[^A-Za-z0-9_])(sc_rkg_\d+)\s*\(/g;
    for (let m; (m = re.exec(l)) !== null; ) if (aborting.has(m[2]!)) n++;
  }
  return n;
}

let dir: string | undefined;
async function emit(on: boolean): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "scriptc-rkgcount-"));
  const tag = on ? "on" : "off";
  const src = join(dir, `main-${tag}.ts`);
  await writeFile(src, PROGRAM, "utf8");
  const had = process.env["SCRIPTC_RKG_COUNT"];
  if (on) process.env["SCRIPTC_RKG_COUNT"] = "1";
  else delete process.env["SCRIPTC_RKG_COUNT"];
  try {
    const res = await compile(src, {
      outPath: join(dir, `program-${tag}`),
      outDir: dir,
      backend: "c",
      emitOnly: true,
    });
    if (!res.ok) {
      throw new Error(`the dial program did not compile: ${res.diagnostics[0]?.message ?? "?"}`);
    }
    return await readFile(res.cPath, "utf8");
  } finally {
    if (had === undefined) delete process.env["SCRIPTC_RKG_COUNT"];
    else process.env["SCRIPTC_RKG_COUNT"] = had;
  }
}

let cached: Promise<{ off: string; on: string }> | undefined;
function both(): Promise<{ off: string; on: string }> {
  return (cached ??= (async () => ({ off: await emit(false), on: await emit(true) }))());
}

afterAll(() => {
  delete process.env["SCRIPTC_RKG_COUNT"];
});

describe("SCRIPTC_RKG_COUNT", () => {
  test("the program really does plant aborting keyed reads — nothing below is vacuous", async () => {
    const { off } = await both();
    expect((off.match(TRAP) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(abortableCallSites(off)).toBeGreaterThanOrEqual(2);
  });

  test("OFF emits nothing at all: no line of the counted emitter leaks in", async () => {
    const { off, on } = await both();
    expect(off).not.toContain("SC_RK_HIT");
    expect(off).not.toContain("RKSITE");
    expect(off).not.toContain("sc_rk_hits");
    expect(off).not.toContain("sc_rk_count_dump");
    expect(on.length).toBeGreaterThan(off.length);
  });

  test("ON plants exactly one ordinal per ABORTABLE CALL SITE — real-aborts.mjs's unit", async () => {
    const { off, on } = await both();
    const sites = abortableCallSites(off);
    const hits = [...on.matchAll(HIT)].map((m) => Number(m[1]));
    expect(hits.length).toBe(sites);
    /* and the dial neither adds nor removes a trap */
    expect((on.match(TRAP) ?? []).length).toBe((off.match(TRAP) ?? []).length);
  });

  test("a helper that can answer undefined is NOT counted", async () => {
    const { on } = await both();
    const marked = new Set([...on.matchAll(SITE)].map((m) => m[2]!));
    const aborting = abortingHelpers(on);
    expect(marked.size).toBeGreaterThanOrEqual(1);
    /* every marked helper aborts */
    for (const h of marked) expect(aborting.has(h)).toBe(true);
    /* and the dyn-result helper serving `loose` answers the undefined dyn:
     * it is not in ABORT.real and carries no marker. */
    const dynHelpers = [...on.matchAll(/^static ScrDyn \*(sc_rkg_\d+)\(/gm)].map((m) => m[1]!);
    expect(dynHelpers.length).toBeGreaterThanOrEqual(1);
    for (const h of dynHelpers) expect(marked.has(h)).toBe(false);
  });

  test("the ordinals are dense and unique, so the emitted table has no holes", async () => {
    const { on } = await both();
    const hits = [...on.matchAll(HIT)].map((m) => Number(m[1]));
    expect(new Set(hits).size).toBe(hits.length);
    expect(Math.min(...hits)).toBe(0);
    expect(Math.max(...hits)).toBe(hits.length - 1);
    expect(on).toContain(`static unsigned long sc_rk_hits[${hits.length}];`);
  });

  test("every ordinal is attributable from the TU alone", async () => {
    const { on } = await both();
    const sites = [...on.matchAll(SITE)];
    const hits = [...on.matchAll(HIT)];
    expect(sites.length).toBe(hits.length);
    for (const s of sites) {
      expect(on).toContain(`${s[2]!}(`);
      expect(s[3]!).toMatch(/^r\d+$/);
    }
  });

  test("the dump exists, is a destructor, and reports totals as well as rows", async () => {
    const { on } = await both();
    expect(on).toContain("__attribute__((destructor)) static void sc_rk_count_dump(void) {");
    expect(on).toContain("RKCOUNT-TOTAL sites=");
    expect(on).toContain("RKCOUNT %zu %lu");
  });

  test("a site also announces its FIRST hit, so process.exit() cannot hide it", async () => {
    const { on, off } = await both();
    /* zapo's own entry ends in `process.exit(0)`, which takes `_Exit`: the
     * destructor above never runs on the run that matters, and the first
     * probe binary produced no dump at all. One line per site the first time
     * it executes is already on stderr when the process dies. */
    expect(on).toContain("RKFIRST %zu");
    expect(on).toContain("sc_rk_hits[k]++ == 0");
    expect(off).not.toContain("RKFIRST");
  });
});
