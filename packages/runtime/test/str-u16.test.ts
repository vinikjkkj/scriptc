import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ccCompile, testBin } from "./cc.js";
import { expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const testDir = import.meta.dirname;
const srcDir = join(testDir, "../src");

/* scr_str_cmp_u16 first-difference scan, against the old per-code-point decoder
 * (test_str_u16.c); it prints its positive control (the rule inverted) and the run fails if it stops firing. */
test("the string order agrees with the per-code-point oracle", async () => {
  const buildDir = join(testDir, "build");
  await mkdir(buildDir, { recursive: true });
  const bin = testBin(buildDir, "test_str_u16");
  await ccCompile([
    "-std=c11", "-O1", "-Wall", "-Wextra", "-fsanitize=address", "-DSCR_RC_AUDIT",
    "-o", bin,
    join(testDir, "test_str_u16.c"),
    join(srcDir, "scr_string.c"),
    join(srcDir, "scr_number.c"),
    join(srcDir, "scr_array.c"),
    join(srcDir, "scr_bytes.c"),
    join(srcDir, "scr_error.c"),
    join(srcDir, "scr_exception.c"),
    join(srcDir, "scr_object.c"),
    join(srcDir, "scr_cycle.c"),
    ...(process.platform === "linux" ? ["-D_GNU_SOURCE", "-lm"] : []),
  ]);
  const { stderr } = await execFileAsync(bin, []);
  expect(stderr).toMatch(/^ok pairs=200000 ctl_disagree=\d+$/m);
}, 120000);
