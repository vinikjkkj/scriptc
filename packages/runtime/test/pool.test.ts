import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ccCompile, testBin } from "./cc.js";
import { expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const testDir = import.meta.dirname;
const srcDir = join(testDir, "../src");

// The worker pool (scr_pool.c) compiled alone against the five runtime
// symbols test_pool.c supplies, so a failure can only mean the pool is
// wrong. Plain, AddressSanitizer and (Linux) ThreadSanitizer: the last one
// is the point, since the pool's whole job is to publish worker-written
// bytes to the main thread with nothing but its mutex ordering them. The
// pool is POSIX-threads code in this harness (the Windows arm is compiled
// by the cross build and run by the Windows CI lanes through the corpus).
for (const san of ["none", "address", "thread"] as const) {
  test.skipIf(process.platform === "win32" || (san === "thread" && process.platform !== "linux"))(
    `the worker pool delivers every job exactly once, on the main thread, in completion order (${san})`,
    async () => {
      const buildDir = join(testDir, "build");
      await mkdir(buildDir, { recursive: true });
      const bin = testBin(buildDir, `test_pool_${san}`);
      await ccCompile([
        "-std=c11", "-O1", "-g", "-Wall", "-Wextra", "-Wno-unused-parameter",
        ...(san === "none" ? [] : [`-fsanitize=${san}`]),
        "-o", bin,
        join(testDir, "test_pool.c"),
        join(srcDir, "scr_pool.c"),
        join(srcDir, "scr_stack_margin.c"),
        ...(process.platform === "linux" ? ["-D_GNU_SOURCE", "-lm", "-lpthread"] : []),
      ]);
      const { stderr } = await execFileAsync(bin, [], { timeout: 120_000 });
      expect(stderr.trim()).toBe("all pool tests passed");
    },
    180_000,
  );
}
