/* --layout-order on a program emitted as several translation units. The unit tests of layout-order.ts cannot see this: the failure is
 * a C compile error in one part, and only a split program has parts.
 *
 * WHAT BROKE. The C emitter pooled the interned walkers (dyn builders) with the function chunks so the steady set would be one run. A
 * walker's static DATA (the key-order tables sc_ko_<shape>_n/_l/_c of a shape with several literal key orders) lives in walkerDefs, which
 * a split program writes into a different unit than the bodies, so a walker that moved into a body part named data its part cannot see:
 * `use of undeclared identifier 'sc_ko_r0_n'`. It only showed on the REST app build (the first split program to carry an order file),
 * because the layout rows ran whole. The walkers are now pooled only when the program is NOT split.
 *
 * The program below has one shape with two literal key orders and a cast to it, which is what emits the tables; SCRIPTC_SPLIT_PARTS
 * forces the split (the same seam tu-split.test.ts uses), and the order file names the cast builder so it is a moved chunk. */
import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { compile } from "@scriptc/compiler";
import { cDefinedNames } from "../../packages/compiler/src/backend/layout-order.js";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");

const SOURCE = [
  "interface P { x: number; y: number }",
  "const a: P = { x: 1, y: 2 };",
  "const b: P = { y: 3, x: 4 };",
  "function parse(s: string): P { return JSON.parse(s) as P }",
  "const q = parse('{\"y\":1,\"x\":2}');",
  "console.log(Object.keys(a).join(), Object.keys(b).join(), Object.keys(q).join(), q.x + q.y);",
  "",
].join("\n");

async function build(tag: string, parts: number | null, layout: boolean): Promise<{ binary: string; parts: string[] }> {
  const dir = join(cacheDir, `layout-split-${tag}`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const src = join(dir, "p.ts");
  await writeFile(src, SOURCE);
  const order = join(dir, "order.txt");
  await writeFile(order, "# the cast builder first, then the parse function\nsc_dc_0\nsc_f_parse\n");
  const previous = process.env["SCRIPTC_SPLIT_PARTS"];
  if (parts === null) delete process.env["SCRIPTC_SPLIT_PARTS"];
  else process.env["SCRIPTC_SPLIT_PARTS"] = String(parts);
  try {
    const result = await compile(src, {
      outPath: join(dir, exeName("program")),
      outDir: dir,
      backend: "c",
      ...(layout ? { layoutOrder: order } : {}),
    });
    if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    return { binary: result.binaryPath, parts: result.cPathParts ?? [] };
  } finally {
    if (previous === undefined) delete process.env["SCRIPTC_SPLIT_PARTS"];
    else process.env["SCRIPTC_SPLIT_PARTS"] = previous;
  }
}

describe("--layout-order with a split C program", () => {
  test("a program with key-order tables builds split and answers as it does whole", async () => {
    const whole = await build("whole", null, false);
    const split = await build("split", 3, true);
    expect(split.parts.length, "the program must really be split").toBeGreaterThan(0);
    const out = (b: string): string => execFileSync(b, [], { encoding: "utf8" });
    expect(out(split.binary)).toBe(out(whole.binary));
    expect(out(split.binary)).toBe("x,y y,x y,x 3\n");
  }, 240_000);
});

/* The same programs tu-split.test.ts uses for the split itself, now with an order file that REVERSES every function the whole build
 * defines (the most a permutation can move). Whole, split in 3 and split in 4 must all answer the same, and no function may be lost or
 * duplicated by the reordering. These programs drag in the families a split has to keep apart: vtables and class helpers, async spawn
 * wrappers and frames, generators, and the lazily interned dyn walkers with their data.
 *
 * NOT covered, and said so: the per-shape record helpers (sc_rnew/rrelease/rretain/rtrace/rgcfree) are written in the prelude, before
 * the function bodies, and are not reordered on the C backend; this checks only that they do not break the build or the answer. */
const PROGRAMS = [
  "tests/corpus/1020-async-basics.ts",
  "tests/corpus/1301-errors-subclass.ts",
  "tests/corpus/2252-class-iterators.ts",
  "tests/corpus/24111-union-array-live-view-in-a-split-program.js",
];

async function buildFile(src: string, tag: string, parts: number | null, orderFile: string | null): Promise<{ binary: string; cPath: string; units: string[] }> {
  const dir = join(cacheDir, `layout-split-${tag}`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const previous = process.env["SCRIPTC_SPLIT_PARTS"];
  if (parts === null) delete process.env["SCRIPTC_SPLIT_PARTS"];
  else process.env["SCRIPTC_SPLIT_PARTS"] = String(parts);
  try {
    const result = await compile(join(repoRoot, src), {
      outPath: join(dir, exeName("program")),
      outDir: dir,
      backend: "c",
      ...(orderFile !== null ? { layoutOrder: orderFile } : {}),
    });
    if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    return { binary: result.binaryPath, cPath: result.cPath, units: [result.cPath, ...(result.cPathParts ?? [])] };
  } finally {
    if (previous === undefined) delete process.env["SCRIPTC_SPLIT_PARTS"];
    else process.env["SCRIPTC_SPLIT_PARTS"] = previous;
  }
}

const definedNames = (units: readonly string[]): string[] => units.flatMap((u) => cDefinedNames(readFileSync(u, "utf8").split("\n")));

describe("--layout-order with the programs the TU split is tested on", () => {
  for (const src of PROGRAMS) {
    test(`${src}: a full reversal builds whole, split in 3 and split in 4 and answers the same`, async () => {
      const tag = src.replace(/[^a-z0-9]+/gi, "-").slice(-40);
      const whole = await buildFile(src, `${tag}-whole`, null, null);
      const wholeNames = definedNames(whole.units);
      expect(wholeNames.length).toBeGreaterThan(0);
      const order = join(cacheDir, `layout-split-${tag}-order.txt`);
      await writeFile(order, [...wholeNames].reverse().join("\n") + "\n");
      const answer = (b: string): string => {
        try {
          return execFileSync(b, [], { encoding: "utf8" });
        } catch (err) {
          return (err as { stdout?: string }).stdout ?? "";
        }
      };
      const expected = answer(whole.binary);
      for (const parts of [null, 3, 4]) {
        const built = await buildFile(src, `${tag}-p${parts ?? "1"}`, parts, order);
        if (parts !== null) expect(built.units.length, `split in ${parts}`).toBeGreaterThan(1);
        expect(answer(built.binary), `parts=${parts}`).toBe(expected);
        // nothing lost, nothing duplicated (a split may rename linkage, never the set of definitions)
        expect([...definedNames(built.units)].sort(), `parts=${parts}`).toEqual([...wholeNames].sort());
      }
    }, 600_000);
  }
});
