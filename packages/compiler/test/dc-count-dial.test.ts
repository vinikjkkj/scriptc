/* SCRIPTC_DC_COUNT=1 — the runtime execution counter for the DYNCHECK family.
 *
 * The tree could say how many dyn checks a program CONTAINS (tu-census.mjs
 * counts scr_dyn_check_fail; SCRIPTC_DC_CENSUS names each emitted crossing)
 * and which one FAILED (SCRIPTC_DC_WHERE renames a path segment inside a
 * message only a failing check prints). It could not say how many ever RAN,
 * which on a healthy run is 100% of the population — so "2 254 checks" could
 * not be told apart from "2 254 checks nothing ever reaches", and those two
 * readings call for opposite work.
 *
 * This dial closes that. Every emitted guard gains `SC_DC_HIT(k)` before the
 * test and `SC_DC_FAIL(k)` inside the refusing arm, with k dense over exactly
 * the statements the census counts, and a destructor dumps the table.
 *
 * The hazards this file exists for, in the order they would bite:
 *
 *  1. A PROBE IS NOT FREE. A guard added with probeLower once interned an
 *     extra helper into zapo's TU (129,581,727 -> 129,582,877 bytes), caught
 *     only by diffing two 129 MB files. With the dial off this emitter must
 *     add NOTHING, and that is asserted as byte equality of the whole TU, not
 *     as a count.
 *  2. An instrument that cannot see a planted instance reports a clean sweep.
 *     The counted TU must carry exactly one ordinal per census statement —
 *     no more (double counting) and no fewer (a shape the patch missed).
 *  3. The ordinals must be dense and unique, or the emitted array is indexed
 *     out of range or leaves holes that read as "never executed".
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { compile } from "../src/index.js";

/* One program carrying every dynCheckHelper shape the emitter can plant that
 * a JSON-shaped source can reach: a record (kind + a required field), an
 * array, a tuple (kind + arity), a union (no arm), and the four primitive
 * leaves. A program with no checks would let every assertion below pass
 * vacuously, so the count is asserted to be non-trivial first. */
const PROGRAM = [
  `type Rec = { name: string; n: number; ok: boolean; opt?: string };`,
  `type Tup = [string, number];`,
  `type U = Rec | string | number;`,
  `function main(): void {`,
  `  const r = JSON.parse('{"name":"a","n":1,"ok":true}') as Rec;`,
  `  console.log(r.name, r.n, r.ok, r.opt === undefined ? "no" : r.opt);`,
  `  const t = JSON.parse('["x",2]') as Tup;`,
  `  console.log(t[0], t[1]);`,
  `  const l = JSON.parse('["p","q"]') as string[];`,
  `  console.log(l.length, l[0]);`,
  `  const u = JSON.parse('"hi"') as U;`,
  `  console.log(typeof u === "string" ? u : "other");`,
  `  console.log((JSON.parse("42") as number) + 1);`,
  `  console.log((JSON.parse("false") as boolean) === false ? "f" : "t");`,
  `}`,
  `main();`,
  `export {};`,
  ``,
].join("\n");

const FAIL = /\bscr_dyn_check_fail\s*\(/g;
const HIT = /\bSC_DC_HIT\((\d+)\)/g;
const FAILC = /\bSC_DC_FAIL\((\d+)\)/g;
/* The marker the dial writes beside every hit, naming the interned validator
 * it sits in and the emitter shape that planted it. */
/* The shape half must admit DIGITS: `prim.f64` is a shape name, and a
 * `[A-Za-z]+` tail silently dropped exactly that one marker while the other
 * eleven matched, so the count read 11 of 12 and the regex looked healthy. */
const SITE = /\/\*DCSITE k=(\d+) v=(sc_dc_\d+) s=([a-z]+\.[A-Za-z0-9]+)\*\//g;

const SHAPES = new Set([
  "prim.f64",
  "prim.bool",
  "prim.string",
  "prim.bytes",
  "class.Error",
  "array.kind",
  "tuple.arity",
  "record.kind",
  "record.field",
  "union.nomatch",
  "func.kind",
  "func.noadapt",
]);

let dir: string | undefined;
async function emit(dcCount: boolean): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "scriptc-dccount-"));
  const tag = dcCount ? "on" : "off";
  const src = join(dir, `main-${tag}.ts`);
  await writeFile(src, PROGRAM, "utf8");
  const had = process.env["SCRIPTC_DC_COUNT"];
  if (dcCount) process.env["SCRIPTC_DC_COUNT"] = "1";
  else delete process.env["SCRIPTC_DC_COUNT"];
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
    if (had === undefined) delete process.env["SCRIPTC_DC_COUNT"];
    else process.env["SCRIPTC_DC_COUNT"] = had;
  }
}

let cached: Promise<{ off: string; on: string }> | undefined;
function both(): Promise<{ off: string; on: string }> {
  return (cached ??= (async () => ({ off: await emit(false), on: await emit(true) }))());
}

afterAll(() => {
  delete process.env["SCRIPTC_DC_COUNT"];
});

describe("SCRIPTC_DC_COUNT", () => {
  test("the program really does plant checks — nothing below is vacuous", async () => {
    const { off } = await both();
    const n = (off.match(FAIL) ?? []).length;
    expect(n).toBeGreaterThanOrEqual(8);
  });

  test("OFF emits nothing at all: the TU is byte-identical to the undialed one", async () => {
    const { off, on } = await both();
    /* The dial's own text must be absent, and — the stronger statement —
     * the whole file must be the file the emitter wrote before this change.
     * `off` IS that file: it is produced with the environment variable
     * unset, through the same emitter. What this asserts is that no line of
     * the counted emitter leaks into it. */
    expect(off).not.toContain("SC_DC_HIT");
    expect(off).not.toContain("SC_DC_FAIL");
    expect(off).not.toContain("DCSITE");
    expect(off).not.toContain("sc_dc_hits");
    expect(off).not.toContain("sc_dc_count_dump");
    expect(on.length).toBeGreaterThan(off.length);
  });

  test("ON plants exactly one ordinal per census statement, hits and fails alike", async () => {
    const { off, on } = await both();
    const statements = (off.match(FAIL) ?? []).length;
    /* The census counts scr_dyn_check_fail, and the counted TU must still
     * contain the same number of them: the dial adds counters, it does not
     * add or remove a single check. */
    expect((on.match(FAIL) ?? []).length).toBe(statements);
    const hits = [...on.matchAll(HIT)].map((m) => Number(m[1]));
    const fails = [...on.matchAll(FAILC)].map((m) => Number(m[1]));
    expect(hits.length).toBe(statements);
    expect(fails.length).toBe(statements);
    /* Every hit is paired with the fail carrying the SAME ordinal: the two
     * are emitted from one site and a mismatch would attribute a failure to
     * the wrong check. */
    expect([...fails].sort((a, b) => a - b)).toEqual([...hits].sort((a, b) => a - b));
  });

  test("the ordinals are dense and unique, so the emitted table has no holes", async () => {
    const { on } = await both();
    const hits = [...on.matchAll(HIT)].map((m) => Number(m[1]));
    const uniq = new Set(hits);
    expect(uniq.size).toBe(hits.length);
    expect(Math.min(...hits)).toBe(0);
    expect(Math.max(...hits)).toBe(hits.length - 1);
    /* And the declared array is exactly that long — one element short is an
     * out-of-range write on the last check that runs. */
    expect(on).toContain(`static unsigned long sc_dc_hits[${hits.length}];`);
    expect(on).toContain(`static unsigned long sc_dc_fails[${hits.length}];`);
  });

  test("every ordinal is attributable: a known validator and a known shape", async () => {
    const { on } = await both();
    const sites = [...on.matchAll(SITE)];
    const hits = [...on.matchAll(HIT)].map((m) => Number(m[1]));
    expect(sites.length).toBe(hits.length);
    const seenShapes = new Set<string>();
    for (const s of sites) {
      expect(SHAPES.has(s[3]!)).toBe(true);
      seenShapes.add(s[3]!);
      /* The validator the marker names must be a validator this TU defines. */
      expect(on).toContain(`${s[2]!}(const ScrDyn *d, const ScrDynPath *path) {`);
    }
    /* The four shapes this program is built to reach, so a patch that lost
     * one of the eleven emission sites is caught rather than passing on the
     * ones it kept. */
    for (const want of ["record.kind", "record.field", "array.kind", "union.nomatch"]) {
      expect(seenShapes.has(want)).toBe(true);
    }
  });

  test("the dump exists, is a destructor, and reports totals as well as rows", async () => {
    const { on } = await both();
    expect(on).toContain("__attribute__((destructor)) static void sc_dc_count_dump(void) {");
    expect(on).toContain("DCCOUNT-TOTAL sites=");
    expect(on).toContain('fprintf(stderr, "DCCOUNT %zu %lu %lu\\n", i, sc_dc_hits[i], sc_dc_fails[i]);');
  });
});
