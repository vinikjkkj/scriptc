/* The CLI's exit must WAIT for its output streams to drain. stdout/stderr
 * to a pipe are async; a process.exit() right after rendering a large
 * diagnostic set drops whatever libuv hasn't flushed — observed as a hard
 * 65536-byte (pipe buffer) truncation mid-code-frame, losing the error
 * count and everything after it. This pins the fixed behavior: a render
 * several times the pipe buffer arrives COMPLETE through a real pipe,
 * final "N errors." line included. */
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const repoRoot = join(import.meta.dirname, "../../..");
const cliEntry = join(repoRoot, "packages/cli/src/main.ts");
/* `--import` takes a module SPECIFIER, and node parses it as a URL first:
 * a win32 absolute path starts with a drive letter, so "G:\...\loader.mjs"
 * parses as the scheme "g:" and node refuses the whole process with
 * ERR_UNSUPPORTED_ESM_URL_SCHEME before the CLI runs at all. The child then
 * exits 1 with ~1KB of node's own stack trace, which this test read as "the
 * render was truncated" — the exact misdiagnosis it exists to prevent. A
 * file:// URL is unambiguous on both platforms. */
const tsxLoader = pathToFileURL(join(dirname(require.resolve("tsx/package.json")), "dist/loader.mjs")).href;

test("a >64KB diagnostic render survives a piped stderr intact", async () => {
  const dir = join(repoRoot, "node_modules/.cache/scriptc-tests/cli-flush");
  mkdirSync(dir, { recursive: true });
  const entry = join(dir, "many-diags.ts");
  // 1200 unsupported statements: each renders a code frame, so the full
  // report is several hundred KB — far past the 64KB pipe buffer where the
  // truncation bit.
  writeFileSync(entry, "debugger;\n".repeat(1200));

  // execFile pipes stdio (the shape that truncated); tolerate the expected
  // exit 1 and keep the full stderr.
  const res = await execFileAsync(
    process.execPath,
    ["--import", tsxLoader, cliEntry, "build", entry],
    { maxBuffer: 16 * 1024 * 1024 },
  ).then(
    () => {
      throw new Error("build of a broken program must exit nonzero");
    },
    (err: { code?: unknown; stderr?: string }) => err,
  );

  expect(res.code).toBe(1);
  const stderr = res.stderr ?? "";
  expect(Buffer.byteLength(stderr)).toBeGreaterThan(64 * 1024);
  // The count line is written LAST — its presence proves the whole render
  // flushed before exit.
  expect(stderr).toMatch(/\n1200 errors\.\n$/);
});
