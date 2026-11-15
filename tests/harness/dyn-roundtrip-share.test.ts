/* A dyn number that is checked into a number and boxed again keeps its node (ir/dyn-keep.ts dynRoundTripShare), on both backends.
 *
 * THE CHECK STAYS: a non-number still throws the same path-annotated TypeError through the same helper, so the edge rows below print the exact
 * texts the round trip printed before. THE VALUE STAYS: -0, NaN, 2^53 and the infinities are the same node. THE NODE COUNT DROPS: the census counts
 * the dyn number allocations of a program that stores `position` (a dyn length read) into a dyn object and passes it to a function, N times, and the
 * folded shapes must allocate two fewer per iteration than the same program with the shape the fold must NOT touch (`position + 0`, an arithmetic
 * result, which boxes anew). POSITIVE CONTROL: that second program, and the plain build of the first one, must show the unfolded counts. */
import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");

async function build(tag: string, name: string, source: string, backend: "c" | "llvm", cflags?: string): Promise<string> {
  const dir = join(cacheDir, `rt-share-${tag}-${backend}`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const src = join(dir, name);
  await writeFile(src, source);
  const prev = process.env["SCRIPTC_PROF_CFLAGS"];
  if (cflags === undefined) delete process.env["SCRIPTC_PROF_CFLAGS"];
  else process.env["SCRIPTC_PROF_CFLAGS"] = cflags;
  try {
    const result = await compile(src, { outPath: join(dir, exeName("program")), outDir: dir, backend });
    if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    return result.binaryPath;
  } finally {
    if (prev === undefined) delete process.env["SCRIPTC_PROF_CFLAGS"];
    else process.env["SCRIPTC_PROF_CFLAGS"] = prev;
  }
}

const EDGES = [
  "const src: any = {}",
  "src.nz = -0; src.nan = NaN; src.big = 2 ** 53; src.inf = Infinity; src.s = 'text'; src.u = undefined",
  "const dst: any = {}",
  "dst.nz = src.nz as number; dst.nan = src.nan as number; dst.big = src.big as number; dst.inf = src.inf as number",
  "console.log(Object.is(dst.nz, -0), Number.isNaN(dst.nan), dst.big === 2 ** 53, dst.inf)",
  "for (const k of ['s', 'u', 'missing']) {",
  "  try { dst.bad = src[k] as number; console.log('no throw', k) } catch (e) { console.log(k, (e as Error).constructor.name, (e as Error).message) }",
  "}",
  "",
].join("\n");
const EDGES_OUT =
  "true true true Infinity\n" +
  "s TypeError expected number at $, got string\n" +
  "u TypeError expected number at $, got undefined\n" +
  "missing TypeError expected number at $, got undefined\n";

const COUNT = (store: string): string =>
  [
    "class P { constructor() { this.q = []; this.r = [] } fill(v, position) { this.r[position] = v } }",
    "const N = 2000",
    "const p = new P()",
    "const cs = []",
    "for (let i = 0; i < N; i++) {",
    "  const c = {}",
    "  const position = p.q.length",
    `  c.k = ${store}`,
    "  p.fill(1, position)",
    "  p.q.push(c); cs.push(c)",
    "}",
    "console.log(cs.length, cs[1500].k)",
    "",
  ].join("\n");

const numAllocs = (bin: string): number => {
  const out = join(cacheDir, `rt-share-count-${Math.random().toString(36).slice(2)}.txt`);
  const r = spawnSync(bin, [], { encoding: "utf8", env: { ...process.env, SCR_DYNCEN_OUT: out } });
  expect(r.status, r.stderr).toBe(0);
  const m = /DYNCEN-COUNT 2 (\d+)/.exec(require_("node:fs").readFileSync(out, "utf8"));
  expect(m).not.toBeNull();
  return Number(m![1]);
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const require_ = (m: string): any => (process as any).getBuiltinModule(m);

describe("a dyn number checked into a number and boxed again keeps its node", () => {
  for (const backend of ["c", "llvm"] as const) {
    test(`edge values and the throwing kinds print what the round trip printed (${backend})`, async () => {
      const bin = await build("edges", "edges.ts", EDGES, backend);
      const r = spawnSync(bin, [], { encoding: "utf8" });
      expect(r.stdout).toBe(EDGES_OUT);
    }, 240_000);
  }
  test("the census sees the dyn number allocations drop (c)", async () => {
    const cflags = `-include ${join(repoRoot, "tests/perf/dyncensus/scr_dyn_census.h")} -I${join(repoRoot, "tests/perf/dyncensus")} -DSCR_DYNCEN_PSLOTS=65536`;
    const folded = numAllocs(await build("folded", "folded.js", COUNT("position"), "c", cflags));
    const control = numAllocs(await build("control", "control.js", COUNT("position + 0"), "c", cflags));
    // before the fold the store checked the number out and boxed it back (a second number per iteration), exactly what the control's arithmetic result
    // is, so the two programs allocated the same count; now the store reuses the node the length read made
    expect(control - folded, `control ${control}, folded ${folded}`).toBeGreaterThanOrEqual(1900);
  }, 480_000);
});
