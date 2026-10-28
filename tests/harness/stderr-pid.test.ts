/* The warning-pid normalisation, pinned against a positive and a negative
 * control. A wrong TRUE here relaxes the exit-0 stderr comparison, and
 * nothing downstream would notice, so both directions are checked. */
import { describe, expect, test } from "vitest";
import { normalizeWarningPid } from "./stderr-pid.js";

const nodeLine = "(node:12993) ExperimentalWarning: The SHA3-256 Web Crypto API algorithm is an experimental feature and might change at any time\n(Use `node --trace-warnings ...` to show where the warning was created)\n";
const nativeLine = nodeLine.replace("12993", "12577");

describe("normalizeWarningPid", () => {
  test("positive control: the same warning from a different pid is equal after normalisation", () => {
    expect(nodeLine).not.toBe(nativeLine); // the raw streams really differ
    expect(normalizeWarningPid(nodeLine)).toBe(normalizeWarningPid(nativeLine));
    expect(normalizeWarningPid(nodeLine)).toBe(nodeLine.replace("(node:12993)", "(node:PID)"));
  });

  test("negative control: a different warning message still fails after normalisation", () => {
    const other = nativeLine.replace("SHA3-256", "SHA3-384");
    expect(normalizeWarningPid(nodeLine)).not.toBe(normalizeWarningPid(other));
  });

  test("only the pid prefix is rewritten, not other numbers", () => {
    expect(normalizeWarningPid("(node:7) x 12 (node:8)")).toBe("(node:PID) x 12 (node:PID)");
    expect(normalizeWarningPid("no prefix here 42")).toBe("no prefix here 42");
  });
});
