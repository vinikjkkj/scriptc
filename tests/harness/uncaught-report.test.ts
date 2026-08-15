/* The uncaught-report reduction, pinned on both sides.
 *
 * Every predicate in uncaught-report.ts is silent in one direction: a
 * wrong TRUE relaxes a byte comparison the differential suite would
 * otherwise make, and nothing downstream can notice. So each one is
 * pinned here against BOTH a real Node v25.9.0 report and a negative
 * control, with the inputs quoted verbatim rather than constructed.
 */
import { describe, expect, test } from "vitest";
import { oracleCrashed, reduceNativeReport, reduceNodeReport } from "./uncaught-report.js";

const buf = (s: string): Buffer => Buffer.from(s, "utf8");

/** Node v25.9.0, Windows, `tests/corpus/1361-spawn-events.ts`. */
const SPAWN_ENOENT = [
  "node:events:487",
  "      throw er; // Unhandled 'error' event",
  "      ^",
  "",
  "Error: spawn /bin/sh ENOENT",
  "    at ChildProcess._handle.onexit (node:internal/child_process:286:19)",
  "    at onErrorNT (node:internal/child_process:507:16)",
  "Emitted 'error' event on ChildProcess instance at:",
  "    at ChildProcess._handle.onexit (node:internal/child_process:292:12) {",
  "  errno: -4058,",
  "  code: 'ENOENT',",
  "  syscall: 'spawn /bin/sh',",
  "  path: '/bin/sh',",
  "  spawnargs: [ '-c', 'exit 4' ]",
  "}",
  "",
  "Node.js v25.9.0",
  "",
].join("\n");

/** Node v25.9.0, `tests/corpus/2381-builtin-default-imports.js` — the
 * `Name [ERR_CODE]:` stack decoration. */
const URL_PATH = [
  "node:internal/url:1484",
  "    throw new ERR_INVALID_FILE_URL_PATH('must be absolute', url);",
  "          ^",
  "",
  "TypeError [ERR_INVALID_FILE_URL_PATH]: File URL path must be absolute",
  "    at getPathFromURLWin32 (node:internal/url:1484:11)",
  "",
  "Node.js v25.9.0",
  "",
].join("\n");

/** Node v25.9.0, `tests/corpus/1552-exec-options-record.ts` — util.inspect's
 * circular marker in front of the error line. */
const CIRCULAR = [
  "node:internal/child_process:1127",
  "    result.error = new ErrnoException(result.error, 'spawnSync ' + options.file);",
  "                   ^",
  "",
  "<ref *1> Error: spawnSync /bin/echo ENOENT",
  "    at Object.spawnSync (node:internal/child_process:1127:20)",
  "",
  "Node.js v25.9.0",
  "",
].join("\n");

describe("reduceNodeReport", () => {
  test("keeps the error's name and message and drops the report", () => {
    expect(reduceNodeReport(buf(SPAWN_ENOENT))).toEqual({
      pre: "",
      line: "Error: spawn /bin/sh ENOENT",
    });
  });

  test("the `Name [ERR_CODE]:` decoration is the report's, not the error's", () => {
    expect(reduceNodeReport(buf(URL_PATH))).toEqual({
      pre: "",
      line: "TypeError: File URL path must be absolute",
    });
  });

  test("util.inspect's circular marker is dropped", () => {
    expect(reduceNodeReport(buf(CIRCULAR))).toEqual({
      pre: "",
      line: "Error: spawnSync /bin/echo ENOENT",
    });
  });

  test("the program's own stderr before the report is kept, verbatim", () => {
    const r = reduceNodeReport(buf("warn one\nwarn two\n" + SPAWN_ENOENT));
    expect(r?.pre).toBe("warn one\nwarn two");
    expect(r?.line).toBe("Error: spawn /bin/sh ENOENT");
  });

  test("CRLF stderr reduces the same way (this host's Node writes CRLF)", () => {
    expect(reduceNodeReport(buf(SPAWN_ENOENT.replaceAll("\n", "\r\n")))?.line).toBe(
      "Error: spawn /bin/sh ENOENT",
    );
  });

  // The negative controls: anything that is NOT a crash report must
  // answer null, because null is what keeps the byte comparison.
  test("plain program stderr is not a report", () => {
    expect(reduceNodeReport(buf("some warning\nanother\n"))).toBeNull();
  });

  test("empty stderr is not a report", () => {
    expect(reduceNodeReport(Buffer.alloc(0))).toBeNull();
  });

  test("a caret with no error line after it is not a report", () => {
    expect(reduceNodeReport(buf("a.js:1\nx\n^\n\n"))).toBeNull();
  });

  test("a lone caret at the top of stderr is not a report", () => {
    expect(reduceNodeReport(buf("^\nError: boom\n"))).toBeNull();
  });
});

describe("reduceNativeReport", () => {
  test.for([
    ["Uncaught Error: spawn /bin/sh ENOENT\n", "Error: spawn /bin/sh ENOENT"],
    ["Unhandled promise rejection: Error: spawn /bin/sh ENOENT\n", "Error: spawn /bin/sh ENOENT"],
    ["Unhandled 'error' event: Error: spawn /bin/sh ENOENT\n", "Error: spawn /bin/sh ENOENT"],
  ] as const)("%s reduces to its error", ([raw, line]) => {
    expect(reduceNativeReport(buf(raw))).toEqual({ pre: "", line });
  });

  test("the program's own stderr before the report is kept, verbatim", () => {
    expect(reduceNativeReport(buf("warn one\nwarn two\nUncaught TypeError: nope\n"))).toEqual({
      pre: "warn one\nwarn two",
      line: "TypeError: nope",
    });
  });

  // The negative controls: a binary that reported NOTHING, or reported
  // something that is not an uncaught line, must answer null — the
  // comparison then fails, which is the point.
  test("a binary that exits without reporting answers null", () => {
    expect(reduceNativeReport(Buffer.alloc(0))).toBeNull();
  });

  test("ordinary stderr output is not an uncaught report", () => {
    expect(reduceNativeReport(buf("hello from console.error\n"))).toBeNull();
  });

  test("only the LAST line is the report", () => {
    expect(reduceNativeReport(buf("Uncaught Error: first\nplain trailing line\n"))).toBeNull();
  });
});

describe("oracleCrashed", () => {
  test("an exit-0 program whose Node run died with a report", () => {
    expect(oracleCrashed(1, 0, buf(SPAWN_ENOENT))).toBe(true);
  });

  test("a program that DECLARED its nonzero exit keeps the historical contract", () => {
    expect(oracleCrashed(1, 1, buf(SPAWN_ENOENT))).toBe(false);
  });

  test("a Node run that exited 0 is not a crash, whatever it printed", () => {
    expect(oracleCrashed(0, 0, buf(SPAWN_ENOENT))).toBe(false);
  });

  test("a nonzero exit with no report is not a crash (process.exit(1))", () => {
    expect(oracleCrashed(1, 0, buf("goodbye\n"))).toBe(false);
  });
});

describe("the reduction never equates two DIFFERENT errors", () => {
  test.for([
    ["Uncaught Error: spawn /bin/zsh ENOENT\n", "a different message"],
    ["Uncaught TypeError: spawn /bin/sh ENOENT\n", "a different name"],
    ["Uncaught Error: spawn /bin/sh ENOENT extra\n", "a longer message"],
  ] as const)("%s (%s) does not reduce to the oracle's line", ([raw]) => {
    const want = reduceNodeReport(buf(SPAWN_ENOENT))!;
    expect(reduceNativeReport(buf(raw))?.line).not.toBe(want.line);
  });

  test("a prefix the compiled side did not print is a mismatch", () => {
    const want = reduceNodeReport(buf("warn one\n" + SPAWN_ENOENT))!;
    const got = reduceNativeReport(buf("Uncaught Error: spawn /bin/sh ENOENT\n"))!;
    expect(got.line).toBe(want.line);
    expect(got.pre).not.toBe(want.pre);
  });
});
