/* The cycle arena carves blocks at 8-byte strides (SCR_CYC_ARENA_STRIDE_ALIGN), not 16: a 40-byte class is carved at 40, not 48. (With the 8-byte ScrCycHdr a union box is a 32-byte block, a 16 multiple, so it no longer exercises the stride; a three-pointer class instance is the 40-byte block.)
 *
 * POSITIVE CONTROL: the same program built with -DSCR_CYC_ARENA_STRIDE_ALIGN=16 (the old stride) must hold 8 more bytes per instance, so two million
 * instances cost about 16 MB more, and the 8-byte arm must land near 49 bytes per array element (a 40-byte union block plus an 8-byte slot, plus the
 * program's own growth) against about 57. The program prints the same numbers either way: only the resident size differs. Linux only: the resident
 * size is read from /proc/self/status, and the arena is off under --sanitize (SCR_RC_AUDIT), so this runs plain. */
import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");

const SOURCE = [
  'import { readFileSync } from "node:fs";',
  'const rss = (): number => { const m = /VmRSS:\\s+(\\d+)/.exec(readFileSync("/proc/self/status", "utf8")); return m ? Number(m[1]) : -1; };',
  "class Node3 { a: Node3 | null = null; b: Node3 | null = null; c: Node3 | null = null; }",
  "const N = 2_000_000;",
  "const before = rss();",
  "const a: Node3[] = [];",
  "for (let i = 0; i < N; i++) a.push(new Node3());",
  'console.log("objects", a.length, "delta_kB", rss() - before);',
  "",
].join("\n");

async function build(tag: string, cflags: string | undefined): Promise<string> {
  const dir = join(cacheDir, `cycle-stride-${tag}`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const src = join(dir, "p.ts");
  await writeFile(src, SOURCE);
  const prev = process.env["SCRIPTC_PROF_CFLAGS"];
  if (cflags === undefined) delete process.env["SCRIPTC_PROF_CFLAGS"];
  else process.env["SCRIPTC_PROF_CFLAGS"] = cflags;
  try {
    const result = await compile(src, { outPath: join(dir, exeName("program")), outDir: dir, backend: "c" });
    if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    return result.binaryPath;
  } finally {
    if (prev === undefined) delete process.env["SCRIPTC_PROF_CFLAGS"];
    else process.env["SCRIPTC_PROF_CFLAGS"] = prev;
  }
}

const delta = (bin: string): number => {
  const r = spawnSync(bin, [], { encoding: "utf8" });
  const m = /objects (\d+) delta_kB (-?\d+)/.exec(r.stdout);
  expect(m, `no result line in: ${r.stdout}${r.stderr}`).not.toBeNull();
  expect(Number(m![1])).toBe(2_000_000);
  return Number(m![2]);
};

describe.skipIf(process.platform !== "linux")("the cycle arena stride", () => {
  test("8-byte strides hold 2M 40-byte instances in about 16 MB less than 16-byte strides", async () => {
    const eight = await build("8", undefined);
    const sixteen = await build("16", "-DSCR_CYC_ARENA_STRIDE_ALIGN=16");
    const d8 = delta(eight);
    const d16 = delta(sixteen);
    expect(d16 - d8, `old ${d16} kB, new ${d8} kB`).toBeGreaterThan(12_000);
    expect((d8 * 1024) / 2_000_000).toBeLessThan(52);
    expect((d16 * 1024) / 2_000_000).toBeGreaterThan(55);
  }, 480_000);
});
