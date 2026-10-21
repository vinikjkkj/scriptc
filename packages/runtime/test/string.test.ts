import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { caseFileSize, ccCompile, expectAbort, exeSuffix } from "./cc.js";
import { beforeAll, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const testDir = import.meta.dirname;
const bin = join(testDir, "build", "test_string" + exeSuffix);
const casesFile = join(testDir, "string-cases.txt");
/** test_string.c's divergence_asserts() runs 8 checks the case file does
 * not carry, so the oracle's denominator is the file plus these. */
const BUILTIN_CASES = 8;

// Compiles the C-side oracle test once for both tests below. Built with
// ASan + the RC audit so the oracle run also proves the new string
// functions neither leak nor double-free across ~26k calls.
beforeAll(async () => {
  await mkdir(join(testDir, "build"), { recursive: true });
  await ccCompile([
    "-std=c11", "-O1", "-Wall", "-Wextra",
    "-fsanitize=address", "-DSCR_RC_AUDIT",
    ...(process.platform === "linux" ? ["-D_GNU_SOURCE"] : []),
    "-o", bin,
    join(testDir, "test_string.c"),
    join(testDir, "../src/scr_string.c"),
    join(testDir, "../src/scr_number.c"),
    // scr_str_split returns a real string[]: the array module and its
    // own dependencies join the link (the array.test.ts set).
    join(testDir, "../src/scr_array.c"),
    join(testDir, "../src/scr_bytes.c"),
    join(testDir, "../src/scr_error.c"),
    join(testDir, "../src/scr_exception.c"),
    join(testDir, "../src/scr_object.c"),
    join(testDir, "../src/scr_cycle.c"),
    ...(process.platform === "linux" ? ["-lm"] : []),
  ]);
});

// Runs against the committed case file (generated once from Node via
// gen-string-cases.mjs — see that file to regenerate). Covers UTF-16
// length/charCodeAt/indexOf/includes/startsWith/endsWith/slice/repeat/
// trim/trimStart/trimEnd/split/padStart/padEnd/charAt plus parseInt over
// ASCII, Latin-1, CJK, astral, and combining-mark strings, including the
// documented lone-surrogate → U+FFFD divergence.
//
// Exactly two parseInt cases are recorded for the host that generated the
// file, not for every host: giant base-36 inputs. V8 assembles them with
// one double multiply-add per 5-digit chunk (`number * multiplier + part`),
// and whether that is one rounding (a fused multiply-add) or two depends on
// the CPU the V8 binary was built for. The committed values are the fused
// ones (an arm64 Mac); Node on x86-64 (Linux, the Windows runners, CI's
// pinned v24.15.0, and v22/v25 here) answers with the unfused ones, and so
// does the port, which reproduces V8's loop and fuses exactly when its own
// compiler does. MEASURED: gen-string-cases.mjs regenerated under Node
// 22.18, 24.15 and 25.9 on x86-64 differs from the committed file in these
// two lines only, and the replacement bytes are the port's.
//
// So the committed bytes are not a portable oracle for these two inputs and
// the right oracle is the running host's own Node, which is what this test
// asks. The allowlist is keyed by exact input: a third mismatching case, or
// either of these disagreeing with THIS host's Node, still fails loudly.
const HOST_ARCH_PARSEINT: ReadonlySet<string> = new Set([
  // parseInt("9007199254740993", 36): fused 1.9896986116031812e+24,
  // unfused 1.9896986116031807e+24.
  "parseInt(39303037313939323534373430393933 ; 36)",
  // parseInt("123456789012345678901234567890", 36): fused
  // 1.436287679432363e+45, unfused 1.4362876794323633e+45.
  "parseInt(313233343536373839303132333435363738393031323334353637383930 ; 36)",
]);

/** What this host's Node says for a `parseInt(<hex> ; 36)` mismatch key, as hex of String(result). */
function hostParseInt36(key: string): string {
  const m = /^parseInt\(([0-9a-f]+) ; 36\)$/.exec(key);
  expect(m, `not a radix-36 parseInt key: ${key}`).not.toBeNull();
  const input = Buffer.from(m![1]!, "hex").toString("utf8");
  return Buffer.from(String(parseInt(input, 36)), "utf8").toString("hex");
}

test("string methods match Node on committed oracle cases", async () => {
  const r = await execFileAsync(bin, [casesFile]).then(
    (v) => ({ stderr: v.stderr }),
    (e: Error & { stderr?: string }) => ({ stderr: e.stderr ?? "" }),
  );
  const lines = r.stderr.trim().split("\n").map((l) => l.trimEnd());
  const mismatches = lines.filter((l) => l.startsWith("MISMATCH "));
  for (const line of mismatches) {
    const m = /^MISMATCH (.+) expected=[0-9a-f]* got=([0-9a-f]*)$/.exec(line);
    expect(m, `unparseable mismatch line: ${line}`).not.toBeNull();
    expect(HOST_ARCH_PARSEINT.has(m![1]!), `not a host-arch-dependent case: ${line}`).toBe(true);
    expect(m![2], `${m![1]} vs this host's Node: ${line}`).toBe(hostParseInt36(m![1]!));
  }
  // The harness prints at most 20 mismatch lines; the pass-count tail is
  // the ground truth that NOTHING beyond the printed (allowlisted) set
  // failed.
  const t = /^(\d+)\/(\d+) cases passed$/.exec(lines.at(-1) ?? "");
  expect(t, `missing pass-count line: ${lines.at(-1)}`).not.toBeNull();
  // ...and the DENOMINATOR is the ground truth that the run covered the
  // corpus. Without this the allowlist above is checked against whatever
  // subset the harness happened to reach.
  expect(Number(t![2]), "cases run vs the committed corpus").toBe(caseFileSize(casesFile) + BUILTIN_CASES);
  expect(Number(t![2]) - Number(t![1]), "failed-case count").toBe(mismatches.length);
  expect(mismatches.length).toBeLessThanOrEqual(HOST_ARCH_PARSEINT.size);
});

// repeat(count) with count < 0 or Infinity is a RangeError in JS; scriptc
// has no exceptions, so the runtime must print the error and abort().
test.each(["--crash-repeat", "--crash-repeat-inf"])(
  "repeat RangeError aborts (%s)",
  async (mode) => {
    const err = await execFileAsync(bin, [mode]).then(
      () => {
        throw new Error("expected scr_str_repeat to abort");
      },
      (e: Error & { signal?: string; stderr?: string }) => e,
    );
    expectAbort(err);
    expect(err.stderr).toContain("scriptc: RangeError: Invalid count value");
  },
);
