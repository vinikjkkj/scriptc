import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ccCompile, testBin } from "./cc.js";
import { expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const testDir = import.meta.dirname;
const srcDir = join(testDir, "../src");

/* A Set stores its elements as map KEYS, so an element holding the set
 * back closes a cycle through the key side. The value-only trace could not
 * see that edge, and the teardown released keys precisely because they
 * were never traced -- so the two had to change together or the keys would
 * be freed twice.
 *
 * The RC audit's live counters are what make this assertable here: a
 * sanitizer would be the other way to see it, and zig's mingw target has
 * no asan runtime (see cc.ts). */

const SOURCES = [
  "scr_map.c", "scr_array.c", "scr_string.c", "scr_number.c", "scr_cycle.c",
  "scr_exception.c", "scr_error.c", "scr_object.c", "scr_union.c", "scr_closure.c",
  "scr_lib.c", "scr_console.c", "scr_json.c", "scr_async.c", "scr_child.c", "scr_bytes.c",
].map((f) => join(srcDir, f));

test("a cycle through a Set's element is collected", async () => {
  const buildDir = join(testDir, "build");
  await mkdir(buildDir, { recursive: true });
  const bin = testBin(buildDir, "test_set_key_cycle");
  await ccCompile([
    "-std=c11", "-O1", "-Wall", "-Wextra", "-DSCR_RC_AUDIT",
    "-I", srcDir,
    ...(process.platform === "linux" ? ["-D_GNU_SOURCE"] : []),
    "-o", bin,
    join(testDir, "test_set_key_cycle.c"),
    ...SOURCES,
    ...(process.platform === "linux" ? ["-lm"] : []),
  ]);
  const { stderr } = await execFileAsync(bin, []);
  expect(stderr.trim()).toBe("set key cycle collected");
});
