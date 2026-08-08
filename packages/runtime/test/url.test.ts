import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { CaseException } from "./cc.js";
import { caseFileSize, ccCompile, expectCasesPassed, exeSuffix, materializeHostCases } from "./cc.js";
import { beforeAll, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const testDir = import.meta.dirname;
const bin = join(testDir, "build", "test_url" + exeSuffix);

// Compiled once with ASan + the RC audit (leak/double-free coverage over
// every bridge call, thrown TypeErrors included).
beforeAll(async () => {
  await mkdir(join(testDir, "build"), { recursive: true });
  await ccCompile([
    "-std=c11", "-O1", "-Wall", "-Wextra",
    "-fsanitize=address", "-DSCR_RC_AUDIT",
    ...(process.platform === "linux" ? ["-D_GNU_SOURCE"] : []),
    "-o", bin,
    join(testDir, "test_url.c"),
    join(testDir, "../src/scr_url.c"),
    join(testDir, "../src/scr_path.c"),
    join(testDir, "../src/scr_string.c"),
    join(testDir, "../src/scr_number.c"),
    join(testDir, "../src/scr_array.c"),
    join(testDir, "../src/scr_bytes.c"),
    join(testDir, "../src/scr_error.c"),
    join(testDir, "../src/scr_exception.c"),
    join(testDir, "../src/scr_object.c"),
    join(testDir, "../src/scr_cycle.c"),
    ...(process.platform === "linux" ? ["-lm"] : []),
  ]);
});

// Runs against the committed case file (generated from Node v24's own
// fileURLToPath/pathToFileURL with { windows: true } — the exact code
// Windows Node dispatches to — via gen-url-cases.mjs; see that file for
// the excluded documented divergences). Covers the win32 arm's drive
// letters, UNC hosts, \\?\UNC\ prefixes, encoded-separator TypeErrors,
// and the UNC-malformation TypeErrors, plus posix-arm legs pinning the
// shared encoding rework. Both arms are NAMED on both sides now: the
// generator always said { windows: true/false }, but test_url.c reached
// for the posix arm through the target-dispatched PUBLIC pair, which is
// the win32 arm on a Windows host — 20 of the 21 "-posix" legs were
// checking the wrong implementation there.
// Two committed cases bake the GENERATING platform (darwin) into their
// bytes, and they are NOT the same kind of thing — see CaseException.
const PLATFORM_CASES: ReadonlyMap<string, CaseException> = new Map([
  // u2p-posix("file://host/a"): Node's non-localhost file-URL host
  // TypeError names process.platform ("… or empty on darwin"), and
  // scr_url.c mirrors Node by naming the RUNTIME platform. Whatever host
  // runs this says its own name on both sides — take the host's bytes.
  ["u2p-posix\t66696c653a2f2f686f73742f61", "host"],
  // p2u-posix("/"): pathToFileURL re-adds the trailing separator that
  // resolve stripped by comparing against `path.sep` — the PLATFORM's
  // separator, not the arm's — so Node on Windows answers `file:////` for
  // a posix-arm root. scr_url.c uses the ARM's separator (win32 ? '\\' :
  // '/'), which is what Node itself answers on a POSIX host and what the
  // committed file holds. The port is right; keep the committed bytes.
  ["p2u-posix\t2f", "committed"],
]);

// The cwd-consulting cases (pathToFileURL of a relative path) cannot be
// pinned as bytes across hosts: gen-url-cases.mjs and test_url.c both
// chdir("/"), which is "/" on a POSIX box and the current DRIVE'S ROOT on
// Windows. materializeHostCases re-derives exactly those from this host's
// Node and asserts the committed bytes still hold everywhere else.
test("file-URL bridge win32 arm matches Node on committed oracle cases", async () => {
  const cases = join(testDir, "build", "url-cases-host.txt");
  const { total, rederived } = await materializeHostCases(
    join(testDir, "gen-url-cases.mjs"),
    join(testDir, "url-cases.txt"),
    cases,
    PLATFORM_CASES,
  );
  expect(total, "oracle population").toBe(caseFileSize(join(testDir, "url-cases.txt")));
  if (process.platform === "win32") {
    // 7 cwd-bound pathToFileURL cases + the platform-named host TypeError.
    expect(rederived, "cases re-derived for this host").toBeGreaterThanOrEqual(7);
  }
  const r = await execFileAsync(bin, [cases]).then(
    (v) => ({ stderr: v.stderr }),
    (e: Error & { stderr?: string }) => ({ stderr: e.stderr ?? "" }),
  );
  expectCasesPassed(r.stderr.trim(), { cases });
});
