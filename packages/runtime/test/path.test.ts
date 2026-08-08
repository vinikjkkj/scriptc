import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ccCompile, expectCasesPassed, exeSuffix, materializeHostCases } from "./cc.js";
import { beforeAll, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const testDir = import.meta.dirname;
const bin = join(testDir, "build", "test_path" + exeSuffix);

// Compiles the C-side oracle test once. Built with ASan + the RC audit so
// the oracle run also proves the win32 path functions neither leak nor
// double-free across ~38k calls.
beforeAll(async () => {
  await mkdir(join(testDir, "build"), { recursive: true });
  await ccCompile([
    "-std=c11", "-O1", "-Wall", "-Wextra",
    "-fsanitize=address", "-DSCR_RC_AUDIT",
    "-o", bin,
    join(testDir, "test_path.c"),
    join(testDir, "../src/scr_path.c"),
    // join/resolve take a packed string[]; the array module and its own
    // dependencies join the link (the array.test.ts set).
    join(testDir, "../src/scr_string.c"),
    join(testDir, "../src/scr_number.c"),
    join(testDir, "../src/scr_array.c"),
    join(testDir, "../src/scr_bytes.c"),
    join(testDir, "../src/scr_error.c"),
    join(testDir, "../src/scr_exception.c"),
    join(testDir, "../src/scr_object.c"),
    join(testDir, "../src/scr_cycle.c"),
    ...(process.platform === "linux" ? ["-D_GNU_SOURCE", "-lm"] : []),
  ]);
});

// Runs against the committed case file (generated once from Node v24's
// path.win32 via gen-path-cases.mjs — see that file to regenerate).
// Covers normalize/join/resolve/relative/dirname/basename/extname/
// isAbsolute/toNamespacedPath over drive-letter roots, UNC and \\?\ / \\.\
// device paths, the Windows reserved device names, mixed separators, and
// a seeded fuzz corpus; the file pins Node's byte-exact answers.
//
// The cwd-consulting cases (resolve, relative, toNamespacedPath) cannot be
// pinned as bytes across hosts — gen-path-cases.mjs and test_path.c both
// chdir("/"), which is "/" on a POSIX box and the current DRIVE'S ROOT
// ("G:\") on Windows, and path.win32 correctly answers differently for each.
// materializeHostCases keeps the committed bytes for every case that does
// NOT consult the cwd (asserting they still hold) and re-derives the rest
// from this host's Node. See the long note in cc.ts. On a POSIX host the
// materialised file is the committed one byte for byte.
test("path.win32 functions match Node on committed oracle cases", async () => {
  const cases = join(testDir, "build", "path-cases-host.txt");
  const { total, rederived } = await materializeHostCases(
    join(testDir, "gen-path-cases.mjs"),
    join(testDir, "path-cases.txt"),
    cases,
  );
  // Floors, in both directions. A corpus that shrinks to nothing passes
  // vacuously; a re-derived set that shrinks to nothing means the probe
  // stopped finding the cwd-bound cases and this quietly became "trust the
  // committed bytes" again — which is exactly the bug being fixed.
  expect(total, "oracle population").toBeGreaterThan(30000);
  if (process.platform === "win32") {
    expect(rederived, "cwd-bound cases re-derived for this host").toBeGreaterThan(8000);
  } else {
    expect(rederived, "a POSIX host generated the committed file: nothing to re-derive").toBe(0);
  }
  const { stderr } = await execFileAsync(bin, [cases]);
  expectCasesPassed(stderr, { cases });
});
