import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ccCompile, expectCasesPassed, exeSuffix } from "./cc.js";
import { afterAll, beforeAll, test } from "vitest";

const execFileAsync = promisify(execFile);
const testDir = import.meta.dirname;
const bin = join(testDir, "build", "test_bytes" + exeSuffix);
// The same file with the inline element accessors compiled out, so the
// inline-versus-call differential in test_inline_accessors runs on both
// arms of the A/B switch and the trap modes abort identically either way.
const binNoFast = join(testDir, "build", "test_bytes_nofast" + exeSuffix);
// And with the f64 arm alone compiled out (the u8 arm stays), which is the
// narrower switch the f64 element arm is measured against.
const binNoF64 = join(testDir, "build", "test_bytes_nof64" + exeSuffix);
let scratch: string;

// Compiled once with ASan + the RC audit: the assertions in test_bytes.c
// cover the ToUint8/ToUint32 coercion matrix, ToIndex construction,
// slice/set copies, the utf8/hex/base64 conversions (invalid-utf8
// replacement included), concat, the u32be pair, the fs Buffer round trip,
// zlib deflate/inflate, and the RC recursion through SCR_ELEM_BYTES arrays
// — the sanitized run proves no leak/double-free across all of them.
beforeAll(async () => {
  await mkdir(join(testDir, "build"), { recursive: true });
  for (const [out, extra] of [
    [bin, []],
    [binNoFast, ["-DSCR_NO_FASTARM"]],
    [binNoF64, ["-DSCR_NO_F64ARM"]],
  ] as const)
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

// The f64 arm's own switch. With it off, test_inline_accessors walks the
// SAME kind x value x index differential with f64 going through the call --
// so a divergence introduced by the arm shows up as a case-count difference
// between this binary and the default one rather than as silence.
test.each([
  ["fast (default)", undefined],
  ["libm (SCR_FASTIDX=0)", "0"],
])("bytes runtime with -DSCR_NO_F64ARM -- %s", async (_name, fastidx) => {
  const env = { ...process.env, ...(fastidx === undefined ? {} : { SCR_FASTIDX: fastidx }) };
  const { stderr } = await execFileAsync(binNoF64, [scratch], { env });
  expectCasesPassed(stderr);
});

