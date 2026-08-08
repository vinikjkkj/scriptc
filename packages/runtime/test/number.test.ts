import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ccCompile, expectCasesPassed, testBin } from "./cc.js";
import { test } from "vitest";

const execFileAsync = promisify(execFile);
const testDir = import.meta.dirname;

// Compiles and runs the C-side oracle test against the committed case file
// (generated once from Node via gen-number-cases.mjs — see that file to
// regenerate or fuzz).
//
// scr_number.c is not a leaf: Number.prototype.toString(radix)
// (scr_num_to_str_radix) reaches scr_str_new / scr_str_alloc_raw and throws
// a named RangeError, so the string/error/object/array family joins the
// link exactly as it does in path.test.ts. It was added by the radix commit
// without extending this list, and the whole oracle stopped building --
// on every platform, for 278 commits -- as `lld-link: error: undefined
// symbol: scr_str_new`, which reads as a runtime bug and is a harness one.
test("scr_f64_to_str matches Node String(x) on committed oracle cases", async () => {
  const buildDir = join(testDir, "build");
  await mkdir(buildDir, { recursive: true });
  const bin = testBin(buildDir, "test_number");
  await ccCompile([
    "-std=c11", "-O2", "-Wall", "-Wextra",
    ...(process.platform === "linux" ? ["-D_GNU_SOURCE"] : []),
    "-o", bin,
    join(testDir, "test_number.c"),
    join(testDir, "../src/scr_number.c"),
    join(testDir, "../src/scr_string.c"),
    join(testDir, "../src/scr_error.c"),
    join(testDir, "../src/scr_exception.c"),
    join(testDir, "../src/scr_object.c"),
    join(testDir, "../src/scr_array.c"),
    join(testDir, "../src/scr_bytes.c"),
    join(testDir, "../src/scr_cycle.c"),
    ...(process.platform === "linux" ? ["-lm"] : []),
  ]);
  const { stderr } = await execFileAsync(bin, [join(testDir, "number-cases.txt")]);
  expectCasesPassed(stderr, { cases: join(testDir, "number-cases.txt") });
});
