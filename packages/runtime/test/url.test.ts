import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { caseFileSize, ccCompile, expectCasesPassed, exeSuffix } from "./cc.js";
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
// shared encoding rework.
// One committed case bakes the GENERATING platform into its bytes: Node's
// non-localhost file-URL host TypeError names the host OS, the oracle was
// generated on darwin, and scr_url.c mirrors Node by naming the RUNTIME
// platform. On Linux the native message is byte-exact against what Linux
// Node itself says — pin exactly that one darwin→linux substitution and
// nothing else.
const LINUX_PLATFORM_MESSAGE_CASES: ReadonlyMap<string, string> = new Map([
  [
    // u2p-posix("file://host/a")
    "u2p-posix(66696c653a2f2f686f73742f61)",
    Buffer.from('ERR:TypeError: File URL host must be "localhost" or empty on linux').toString("hex"),
  ],
]);

// KNOWN RED ON A WINDOWS HOST, for two reasons that are both the oracle's
// and neither the bridge's: gen-url-cases.mjs chdir's to "/" and records
// pathToFileURL's answers against a DRIVE-LESS cwd (Windows has none — the
// C side's chdir("/") lands on the current drive's root, so `file:///rel/x`
// comes back `file:///G:/rel/x`), and the "-posix" legs are generated on
// the assumption, spelled in test_url.c, that the PUBLIC pair is the posix
// arm "on this (posix) host" — on win32 the public pair dispatches to the
// win32 arm and answers different, correct, Windows things.
test("file-URL bridge win32 arm matches Node on committed oracle cases", async () => {
  const cases = join(testDir, "url-cases.txt");
  const r = await execFileAsync(bin, [cases]).then(
    (v) => ({ stderr: v.stderr }),
    (e: Error & { stderr?: string }) => ({ stderr: e.stderr ?? "" }),
  );
  const stderr = r.stderr.trim();
  if (process.platform !== "linux") {
    expectCasesPassed(stderr, { cases });
    return;
  }
  const lines = stderr.split("\n");
  const mismatches = lines.filter((l) => l.startsWith("MISMATCH "));
  for (const line of mismatches) {
    const m = /^MISMATCH (.+) expected=[0-9a-f]* got=([0-9a-f]*)$/.exec(line);
    expect(m, `unparseable mismatch line: ${line}`).not.toBeNull();
    expect(LINUX_PLATFORM_MESSAGE_CASES.get(m![1]!), line).toBe(m![2]);
  }
  // The pass-count tail proves nothing beyond the printed (allowlisted)
  // set failed (the harness caps mismatch printing at 20 lines).
  const t = /^(\d+)\/(\d+) cases passed$/.exec(lines.at(-1) ?? "");
  expect(t, `missing pass-count line: ${lines.at(-1)}`).not.toBeNull();
  // ...and the DENOMINATOR is the ground truth that the run covered the
  // corpus at all: equal pass/total says nothing about skipped cases.
  expect(Number(t![2]), "cases run vs the committed corpus").toBe(caseFileSize(cases));
  expect(Number(t![2]) - Number(t![1]), "failed-case count").toBe(mismatches.length);
  expect(mismatches.length).toBeLessThanOrEqual(LINUX_PLATFORM_MESSAGE_CASES.size);
});
