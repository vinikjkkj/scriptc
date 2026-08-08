import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ccCompile, expectCasesPassed, testBin } from "./cc.js";
import { test } from "vitest";

const execFileAsync = promisify(execFile);
const testDir = import.meta.dirname;

// Compiles and runs the C-side RFC 6455 frame-codec test (scr_websocket.c)
// against the RFC's own worked vectors plus round-trip and boundary
// checks. Pure byte code — no socket, no crypto, no network.
test("scr_websocket frame codec matches RFC 6455 vectors", async () => {
  const buildDir = join(testDir, "build");
  await mkdir(buildDir, { recursive: true });
  const bin = testBin(buildDir, "test_websocket");
  await ccCompile([
    "-std=c11", "-O2", "-Wall", "-Wextra",
    ...(process.platform === "linux" ? ["-D_GNU_SOURCE"] : []),
    "-o", bin,
    join(testDir, "test_websocket.c"),
    join(testDir, "../src/scr_websocket.c"),
  ]);
  const { stderr } = await execFileAsync(bin);
  expectCasesPassed(stderr);
});
