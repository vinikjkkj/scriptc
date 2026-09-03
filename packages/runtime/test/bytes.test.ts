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
// The same file with the inline element accessors compiled out, so the
// inline-versus-call differential in test_inline_accessors runs on both
// arms of the A/B switch and the trap modes abort identically either way.
const binNoFast = join(testDir, "build", "test_bytes_nofast" + exeSuffix);
let scratch: string;

// Compiled once with ASan + the RC audit: the assertions in test_bytes.c
// cover the ToUint8/ToUint32 coercion matrix, ToIndex construction,
// slice/set copies, the utf8/hex/base64 conversions (invalid-utf8
// replacement included), concat, the u32be pair, the fs Buffer round trip,
// zlib deflate/inflate, and the RC recursion through SCR_ELEM_BYTES arrays
// — the sanitized run proves no leak/double-free across all of them.
beforeAll(async () => {
  await mkdir(join(testDir, "build"), { recursive: true });
  for (const [out, extra] of [[bin, []], [binNoFast, ["-DSCR_NO_FASTARM"]]] as const)
  await ccCompile([
    "-std=c11", "-O1", "-Wall", "-Wextra",
    "-fsanitize=address", "-DSCR_RC_AUDIT",
    ...extra,
    "-I", join(testDir, "../src"),
    "-o", out,
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
}, 300_000);

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

// The inline element accessors (scr_bytes_get_inl / scr_bytes_set_inl in
// scr_runtime.h, which is what the emitter lowers `bytes[i]` to) are a
// COMPILE-TIME arm, not an env one: inlined at the call site, an env check
// costs a fifth of what the arm saves, so -DSCR_NO_FASTARM is the switch.
// The second binary compiles the same test file with the arm off, and its
// count must match the first exactly -- test_inline_accessors walks the
// inline-versus-call differential either way, and with the arm off it walks
// the function against itself.
test.each([
  ["fast (default)", undefined],
  ["libm (SCR_FASTIDX=0)", "0"],
])("bytes runtime with -DSCR_NO_FASTARM -- %s", async (_name, fastidx) => {
  const env = { ...process.env, ...(fastidx === undefined ? {} : { SCR_FASTIDX: fastidx }) };
  const { stderr } = await execFileAsync(binNoFast, [scratch], { env });
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
  // The same refusals through the inline accessors the emitter lowers
  // `bytes[i]` to. Identical text is the requirement: the inline arm
  // declines and hands over, it never formats a message of its own.
  ["--crash-inl-get-oob", "typed array index 1 out of bounds (length 1)"],
  ["--crash-inl-get-frac", "typed array index 0.5 out of bounds (length 1)"],
  ["--crash-inl-get-nan", "typed array index NaN out of bounds (length 1)"],
  ["--crash-inl-get-neg", "typed array index -1 out of bounds (length 1)"],
  ["--crash-inl-get-inf", "typed array index Infinity out of bounds (length 1)"],
  ["--crash-inl-get-2p53", "typed array index 9007199254740992 out of bounds (length 1)"],
  ["--crash-inl-set-oob", "typed array index 1 out of bounds (length 1)"],
  ["--crash-inl-set-neg", "typed array index -1 out of bounds (length 1)"],
  ["--crash-inl-set-nan-idx", "typed array index NaN out of bounds (length 1)"],
];

test.each(
  CRASH_MODES.flatMap(([mode, message]) =>
    [undefined, "0"].flatMap((fastidx) =>
      ([false, true] as const).map((nofast) => [mode, message, fastidx, nofast] as const),
    ),
  ),
)("trap aborts (%s, SCR_FASTIDX=%s, SCR_NO_FASTARM=%s)", async (mode, message, fastidx, nofast) => {
  const env = { ...process.env, ...(fastidx === undefined ? {} : { SCR_FASTIDX: fastidx }) };
  const err = await execFileAsync(nofast ? binNoFast : bin, [mode], { env }).then(
    () => {
      throw new Error(`expected ${mode} to abort`);
    },
    (e: Error & { signal?: string; stderr?: string }) => e,
  );
  expectAbort(err);
  expect(err.stderr).toContain(`scriptc: RangeError: ${message}`);
});
