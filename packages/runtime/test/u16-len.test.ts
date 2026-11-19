import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ccCompile, testBin } from "./cc.js";
import { expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const testDir = import.meta.dirname;
const srcDir = join(testDir, "../src");

/* scr_str_utf16_len over non-ASCII strings against a scalar count (test_u16_len.c); it prints its positive control and the run fails if it stops firing. */
test("the vector utf-16 length agrees with a scalar count", async () => {
  const buildDir = join(testDir, "build");
  await mkdir(buildDir, { recursive: true });
  const bin = testBin(buildDir, "test_u16_len");
  await ccCompile([
    "-std=c11", "-O1", "-Wall", "-Wextra", "-fsanitize=address", "-DSCR_RC_AUDIT",
    "-o", bin,
    join(testDir, "test_u16_len.c"),
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
  expect(stderr).toMatch(/^ok ctl_len=\d+$/m);
}, 120000);
