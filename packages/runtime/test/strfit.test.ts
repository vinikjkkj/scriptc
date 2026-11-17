import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ccCompile, testBin } from "./cc.js";
import { expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const testDir = import.meta.dirname;
// STRFIT_SRC points the same test at another runtime tree (the positive control: the pre-change sources must FAIL it).
const srcDir = process.env.STRFIT_SRC ?? join(testDir, "../src");
const SRC = [
  "scr_string.c", "scr_number.c", "scr_array.c", "scr_bytes.c", "scr_error.c", "scr_exception.c", "scr_object.c", "scr_cycle.c",
].map((f) => join(srcDir, f));

async function build(name: string, defines: string[]): Promise<string> {
  const buildDir = join(testDir, "build");
  await mkdir(buildDir, { recursive: true });
  const bin = testBin(buildDir, name);
  await ccCompile([
    "-std=c11", "-O1", "-Wall", "-Wextra", "-fsanitize=address", ...defines,
    "-o", bin, join(testDir, "test_strfit.c"), ...SRC,
    ...(process.platform === "linux" ? ["-D_GNU_SOURCE", "-lm"] : []),
  ]);
  return bin;
}

async function runBin(bin: string): Promise<string> {
  const { stderr } = await execFileAsync(bin, []);
  return stderr;
}

test("one-byte strings are shared immortals and never mutated (RC audit lane)", async () => {
  const out = await runBin(await build("test_strfit_audit", ["-DSCR_RC_AUDIT"]));
  expect(out).toContain("all strfit tests passed");
});
