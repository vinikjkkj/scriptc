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
import { compile } from "@scriptc/compiler";
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
