import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ccCompile, expectAbort, expectCasesPassed, exeSuffix } from "./cc.js";
import { beforeAll, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const testDir = import.meta.dirname;
const bin = join(testDir, "build", "test_array" + exeSuffix);

// Compiled once with ASan + the RC audit: the assertions in test_array.c
// include recursive-release checks (array of strings, array of arrays), and
// the sanitized run proves no leak/double-free across all of them.
beforeAll(async () => {
  await mkdir(join(testDir, "build"), { recursive: true });
  await ccCompile([
    "-std=c11", "-O1", "-Wall", "-Wextra",
    "-fsanitize=address", "-DSCR_RC_AUDIT",
    "-o", bin,
    join(testDir, "test_array.c"),
    join(testDir, "../src/scr_array.c"),
    join(testDir, "../src/scr_string.c"),
    join(testDir, "../src/scr_number.c"),
    join(testDir, "../src/scr_bytes.c"),
    join(testDir, "../src/scr_error.c"),
    join(testDir, "../src/scr_exception.c"),
    join(testDir, "../src/scr_object.c"),
    join(testDir, "../src/scr_cycle.c"),
    ...(process.platform === "linux" ? ["-D_GNU_SOURCE", "-lm"] : []),
  ]);
});

test("array runtime: push/pop/set/get, RC recursion, growth", async () => {
  const { stderr } = await execFileAsync(bin, []);
  expectCasesPassed(stderr);
});

// JS returns undefined for OOB reads and creates holes for far writes; both
// are unrepresentable, so the runtime must trap (documented divergence).
//
// The list below is the REFUSING side of scr_arr_check_index's window, one
// row per arm and per edge, and every row also pins the message TEXT. That
// matters more than it looks: the index reaches the message as a double
// formatted by scr_f64_to_str, so a change to how an index is validated can
// silently change what an out-of-range index is CALLED (0.5 -> 0, Infinity
// -> a number, 2^53 -> 9007199254740992 with a different digit count). A
// refusal that names the wrong index is a worse bug than a slow one, and it
// is invisible to a test that only asserts "it aborted".
test.each([
  ["--crash-get-oob", "array index 1 out of bounds (length 1)"],
  ["--crash-get-frac", "array index 0.5 out of bounds (length 1)"],
  ["--crash-set-oob", "array index 2 out of bounds (length 1)"],
  ["--crash-pop-empty", "pop() on an empty array"],
  ["--crash-get-nan", "array index NaN out of bounds (length 1)"],
  ["--crash-get-neg", "array index -1 out of bounds (length 1)"],
  ["--crash-get-inf", "array index Infinity out of bounds (length 1)"],
  ["--crash-get-neginf", "array index -Infinity out of bounds (length 1)"],
  ["--crash-get-2p53", "array index 9007199254740992 out of bounds (length 1)"],
  ["--crash-get-2p32", "array index 4294967296 out of bounds (length 1)"],
  ["--crash-get-at-len", "array index 1 out of bounds (length 1)"],
  ["--crash-get-empty", "array index 0 out of bounds (length 0)"],
  ["--crash-get-ulp", "array index 1.0000000000000002 out of bounds (length 1)"],
  ["--crash-set-neg", "array index -1 out of bounds (length 1)"],
])("trap aborts (%s)", async (mode, message) => {
  const err = await execFileAsync(bin, [mode]).then(
    () => {
      throw new Error(`expected ${mode} to abort`);
    },
    (e: Error & { signal?: string; stderr?: string }) => e,
  );
  expectAbort(err);
  expect(err.stderr).toContain(`scriptc: RangeError: ${message}`);
});
