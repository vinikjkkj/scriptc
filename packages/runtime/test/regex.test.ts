import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ccCompile, expectCasesPassed, exeSuffix } from "./cc.js";
import { beforeAll, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const testDir = import.meta.dirname;
const bin = join(testDir, "build", "test_regex" + exeSuffix);
const vendorDir = join(testDir, "../vendor/quickjs-ng");

// Compiled once with ASan + the RC audit: test_regex.c asserts the C-level
// contracts (RC accounting of results, catchable throws through the
// exception cell, CESU-8 pattern re-encoding, UTF-16 round-trips) directly
// against the vendored libregexp — the same objects regex-using static
// binaries link.
beforeAll(async () => {
  await mkdir(join(testDir, "build"), { recursive: true });
  await ccCompile([
    // no -Wall/-Wextra: the vendored libunicode.c is not warning-clean
    "-std=c11", "-O1",
    "-fsanitize=address", "-DSCR_RC_AUDIT",
    "-I", vendorDir,
    "-o", bin,
    join(testDir, "test_regex.c"),
    join(testDir, "../src/scr_regex.c"),
    // scr_regex.c hosts assert.match and calls the assert throw/inspect
    // helpers — regex-linking binaries always carry scr_assert.c (cc.ts).
    join(testDir, "../src/scr_assert.c"),
    join(vendorDir, "libregexp.c"),
    join(vendorDir, "libunicode.c"),
    join(testDir, "../src/scr_string.c"),
    join(testDir, "../src/scr_map.c"),
    join(testDir, "../src/scr_array.c"),
    join(testDir, "../src/scr_json.c"),
    join(testDir, "../src/scr_exception.c"),
    join(testDir, "../src/scr_error.c"),
    join(testDir, "../src/scr_number.c"),
    join(testDir, "../src/scr_console.c"),
    join(testDir, "../src/scr_closure.c"),
    join(testDir, "../src/scr_object.c"),
    join(testDir, "../src/scr_union.c"),
    join(testDir, "../src/scr_cycle.c"),
    join(testDir, "../src/scr_lib.c"),
    join(testDir, "../src/scr_bytes.c"),
    ...(process.platform === "linux" ? ["-D_GNU_SOURCE", "-lm"] : []),
  ]);
}, 60_000);

test("regex runtime: matching, substitutions, split, throws, RC accounting", async () => {
  const { stderr } = await execFileAsync(bin, []);
  expectCasesPassed(stderr);
});

test("test() on a g-flagged regex is stateful through lastIndex, like Node", async () => {
  const { stdout } = await execFileAsync(bin, ["--global-test-stateful"]);
  const node = await execFileAsync(process.execPath, [
    "-e",
    'const r=/a/g;for(let i=0;i<4;i++){const t=r.test("aaa");console.log(t+" "+r.lastIndex)}',
  ]);
  expect(stdout).toBe(node.stdout);
  expect(stdout).toBe("true 1\ntrue 2\ntrue 3\nfalse 0\n");
});
