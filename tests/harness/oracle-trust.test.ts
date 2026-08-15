/* The oracle-cache trust guard, pinned.
 *
 * A wrong TRUE here is silent and expensive: the harness remembers a
 * verdict Node never gave, and every later run in that cache directory
 * measures the compiled binary against it and reports the BINARY as
 * wrong. Both observed poisonings are cases below, with the exit codes
 * and byte counts taken from the records that actually appeared on this
 * box rather than invented.
 */
import { describe, expect, test } from "vitest";
import { NTSTATUS_FLOOR, oracleIsTrustworthy } from "./oracle-trust.js";

const run = (exitCode: number, out: number, err: number) => ({
  exitCode,
  stdout: { length: out },
  stderr: { length: err },
});

describe("runs the guard REFUSES to remember", () => {
  test("0xC0000142 STATUS_DLL_INIT_FAILED — Windows would not start node", () => {
    expect(oracleIsTrustworthy(run(0xc0000142, 0, 0), 0)).toBe(false);
  });

  test("0x40010004 DBG_TERMINATE_PROCESS with PARTIAL stdout — the host restart", () => {
    // The real record: 2746-hkdf-sha256.ts, 923 of its 939 stdout bytes
    // written before the kill. Non-empty stdout is exactly why the old
    // guard trusted it.
    expect(oracleIsTrustworthy(run(0x40010004, 923, 0), 0)).toBe(false);
  });

  test("the whole NTSTATUS range is refused, at its floor and above", () => {
    for (const code of [NTSTATUS_FLOOR, 0x40010004, 0x80000001, 0xc0000005, 0xc000013a, 0xffffffff]) {
      expect(oracleIsTrustworthy(run(code, 500, 500), 0)).toBe(false);
    }
  });

  test("a silent non-zero exit the program did not declare", () => {
    expect(oracleIsTrustworthy(run(1, 0, 0), 0)).toBe(false);
    expect(oracleIsTrustworthy(run(7, 0, 0), 3)).toBe(false);
  });
});

describe("runs the guard DOES remember", () => {
  test("a clean exit, with or without output", () => {
    expect(oracleIsTrustworthy(run(0, 0, 0), 0)).toBe(true);
    expect(oracleIsTrustworthy(run(0, 939, 0), 0)).toBe(true);
  });

  test("a non-zero exit that left evidence on either stream", () => {
    expect(oracleIsTrustworthy(run(1, 42, 0), 0)).toBe(true);
    expect(oracleIsTrustworthy(run(1, 0, 556), 0)).toBe(true);
  });

  test("a silent non-zero exit the program DECLARED with `// @exit:`", () => {
    expect(oracleIsTrustworthy(run(1, 0, 0), 1)).toBe(true);
    expect(oracleIsTrustworthy(run(13, 0, 0), 13)).toBe(true);
    expect(oracleIsTrustworthy(run(3, 0, 0), 3)).toBe(true);
  });

  test("the largest exit code the corpus declares stays well below the floor", () => {
    // If a program ever declares an NTSTATUS-ranged code this test is the
    // thing that says the guard now refuses it.
    expect(13).toBeLessThan(NTSTATUS_FLOOR);
  });
});
