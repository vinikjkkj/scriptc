import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ccCompile, expectCasesPassed, exeSuffix } from "./cc.js";
import { beforeAll, test } from "vitest";

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
// KNOWN RED ON A WINDOWS HOST, and it is the ORACLE that is host-bound, not
// the port: gen-path-cases.mjs runs `process.chdir("/")` and records what
// path.win32 answered with a DRIVE-LESS cwd of "/", which only exists on a
// POSIX box. Windows has no drive-less cwd — chdir("/") lands on the
// current drive's root — so every cwd-consulting case (resolve, relative,
// toNamespacedPath) compares `\a` against `G:\a`. The cwd-free majority
// still compares byte-for-byte.
test("path.win32 functions match Node on committed oracle cases", async () => {
  const cases = join(testDir, "path-cases.txt");
  const { stderr } = await execFileAsync(bin, [cases]);
  expectCasesPassed(stderr, { cases });
});
