import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ccCompile, expectAbort, expectCasesPassed, exeSuffix } from "./cc.js";
import { afterAll, beforeAll, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const testDir = import.meta.dirname;
const bin = join(testDir, "build", "test_bytes" + exeSuffix);
let scratch: string;

// Compiled once with ASan + the RC audit: the assertions in test_bytes.c
// cover the ToUint8/ToUint32 coercion matrix, ToIndex construction,
// slice/set copies, the utf8/hex/base64 conversions (invalid-utf8
// replacement included), concat, the u32be pair, the fs Buffer round trip,
// zlib deflate/inflate, and the RC recursion through SCR_ELEM_BYTES arrays
// — the sanitized run proves no leak/double-free across all of them.
beforeAll(async () => {
  await mkdir(join(testDir, "build"), { recursive: true });
  await ccCompile([
    "-std=c11", "-O1", "-Wall", "-Wextra",
    "-fsanitize=address", "-DSCR_RC_AUDIT",
    "-I", join(testDir, "../src"),
    "-o", bin,
    join(testDir, "test_bytes.c"),
    join(testDir, "../src/scr_bytes.c"),
    join(testDir, "../src/scr_bytes_io.c"),
    join(testDir, "../src/scr_zlib.c"),
    join(testDir, "../src/scr_lib.c"),
    join(testDir, "../src/scr_string.c"),
    join(testDir, "../src/scr_array.c"),
    join(testDir, "../src/scr_map.c"),
    join(testDir, "../src/scr_exception.c"),
    join(testDir, "../src/scr_error.c"),
    join(testDir, "../src/scr_number.c"),
    join(testDir, "../src/scr_console.c"),
    join(testDir, "../src/scr_closure.c"),
    join(testDir, "../src/scr_object.c"),
    join(testDir, "../src/scr_union.c"),
    join(testDir, "../src/scr_cycle.c"),
    join(testDir, "../src/scr_json.c"),
    join(testDir, "../src/scr_async.c"),
    join(testDir, "../src/scr_child.c"),
    join(testDir, "../src/scr_path.c"),
    join(testDir, "../src/scr_url.c"),
    "-Wno-deprecated-declarations",
    "-lz",
    ...(process.platform === "linux" ? ["-D_GNU_SOURCE", "-lm"] : []),
  ]);
  scratch = await mkdtemp(join(tmpdir(), "scriptc-bytes-"));
});

afterAll(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

// Both arms of scr_bytes_check_index / scr_bytes_to_u32. The fast arm tests
// the bound and integrality in the integer domain; SCR_FASTIDX=0 keeps the
// original double expression with its libm trunc/fmod. They are only allowed
// to differ in speed, so the SAME binary must print the SAME count both ways.
test.each([
  ["fast (default)", undefined],
  ["libm (SCR_FASTIDX=0)", "0"],
])("bytes runtime: coercions, encodings, zlib, fs, RC -- %s", async (_name, fastidx) => {
  const env = { ...process.env, ...(fastidx === undefined ? {} : { SCR_FASTIDX: fastidx }) };
  const { stderr } = await execFileAsync(bin, [scratch], { env });
  expectCasesPassed(stderr);
});

// JS reads undefined / ignores writes out of bounds on typed arrays; both
// are unrepresentable, so the runtime traps (documented divergence, the
// array runtime's exact discipline).
// One mode per ARM of scr_bytes_check_index, and each one is run under BOTH
// settings of SCR_FASTIDX: a value the fast window rejects must reach the
// same trap with byte-identical text as the original expression, because the
// index reaches the message as a formatted double and a validator change can
// rename it silently.
const CRASH_MODES: readonly (readonly [string, string])[] = [
  ["--crash-get-oob", "typed array index 1 out of bounds (length 1)"],
  ["--crash-get-frac", "typed array index 0.5 out of bounds (length 1)"],
  ["--crash-set-oob", "typed array index 1 out of bounds (length 1)"],
  ["--crash-get-nan", "typed array index NaN out of bounds (length 1)"],
  ["--crash-get-neg", "typed array index -1 out of bounds (length 1)"],
  ["--crash-get-inf", "typed array index Infinity out of bounds (length 1)"],
  ["--crash-get-neginf", "typed array index -Infinity out of bounds (length 1)"],
  ["--crash-get-2p53", "typed array index 9007199254740992 out of bounds (length 1)"],
  ["--crash-get-2p32", "typed array index 4294967296 out of bounds (length 1)"],
  ["--crash-get-at-len", "typed array index 1 out of bounds (length 1)"],
  ["--crash-get-empty", "typed array index 0 out of bounds (length 0)"],
  ["--crash-get-ulp", "typed array index 1.0000000000000002 out of bounds (length 1)"],
  ["--crash-set-neg", "typed array index -1 out of bounds (length 1)"],
];

test.each(
  CRASH_MODES.flatMap(([mode, message]) =>
    [undefined, "0"].map((fastidx) => [mode, message, fastidx] as const),
  ),
)("trap aborts (%s, SCR_FASTIDX=%s)", async (mode, message, fastidx) => {
  const env = { ...process.env, ...(fastidx === undefined ? {} : { SCR_FASTIDX: fastidx }) };
  const err = await execFileAsync(bin, [mode], { env }).then(
    () => {
      throw new Error(`expected ${mode} to abort`);
    },
    (e: Error & { signal?: string; stderr?: string }) => e,
  );
  expectAbort(err);
  expect(err.stderr).toContain(`scriptc: RangeError: ${message}`);
});
