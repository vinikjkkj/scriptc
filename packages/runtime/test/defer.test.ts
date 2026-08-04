import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ccCompile, testBin } from "./cc.js";
import { expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const testDir = import.meta.dirname;
const srcDir = join(testDir, "../src");

// A deferred call that carries arguments is a zero-argument closure that
// CAPTURED them, so its whole ownership story is the capture box's. This
// binary supplies its own deferral queue — scr_random_fill.c needs exactly
// one runtime symbol beyond the bytes core — so the primitive compiles
// against nothing else and a failure can only mean randomFill is wrong.
// The counters are read after each of the three moments where a mistake
// would be silent: the deferral fires, it never fires (the loop's teardown
// drops it), and the deferring call throws before it ever enqueues.
test("deferred calls own their arguments: fired, torn down, and the throwing enqueue", async () => {
  const buildDir = join(testDir, "build");
  await mkdir(buildDir, { recursive: true });
  const bin = testBin(buildDir, "test_defer");
  await ccCompile([
    "-std=c11", "-O1", "-Wall", "-Wextra",
    "-fsanitize=address", "-DSCR_RC_AUDIT",
    "-o", bin,
    join(testDir, "test_defer.c"),
    join(srcDir, "scr_random_fill.c"),
    join(srcDir, "scr_bytes.c"),
    join(srcDir, "scr_closure.c"),
    join(srcDir, "scr_string.c"),
    join(srcDir, "scr_array.c"),
    join(srcDir, "scr_map.c"),
    join(srcDir, "scr_number.c"),
    join(srcDir, "scr_cycle.c"),
    join(srcDir, "scr_error.c"),
    join(srcDir, "scr_exception.c"),
    join(srcDir, "scr_object.c"),
    ...(process.platform === "linux" ? ["-D_GNU_SOURCE", "-lm"] : []),
  ]);
  const { stderr } = await execFileAsync(bin);
  expect(stderr.trim()).toBe("all defer tests passed");
});
