import { execFile, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ccCompile, testBin } from "./cc.js";
import { expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const testDir = import.meta.dirname;
const srcDir = join(testDir, "../src");

/* The TRANSPORT half of the WebSocket client, end to end.
 *
 * websocket-interop.test.ts drives the protocol state machine over a
 * hand-rolled blocking socket, which proves the frames and the handshake
 * are right but says nothing about scr_ws_client.c -- the piece that puts
 * that state machine on a real ScrNetSocket and runs it on the event loop.
 * This covers exactly that seam: want_write reaching the socket, socket
 * bytes reaching recv, and the loop staying alive until the close.
 *
 * ws:// only. wss:// takes its TLS through the caller-supplied ops table
 * (see scr_ws_client.h) precisely so this binary need not link mbedTLS. */

function wsResolvable(): boolean {
  try {
    createRequire(join(testDir, "ws_echo_server.mjs")).resolve("ws");
    return true;
  } catch {
    return false;
  }
}

const enabled = process.env.RUN_WS_INTEROP === "1" && wsResolvable();

const SOURCES = [
  "scr_number.c", "scr_string.c", "scr_array.c", "scr_bytes.c", "scr_map.c",
  "scr_closure.c", "scr_object.c", "scr_union.c", "scr_exception.c", "scr_error.c",
  "scr_console.c", "scr_lib.c", "scr_json.c", "scr_async.c", "scr_child.c",
  "scr_cycle.c", "scr_net.c", "scr_url.c", "scr_path.c", "scr_dyn_handle.c",
  "scr_websocket.c", "scr_ws_client.c",
].map((f) => join(srcDir, f));

// The poller is one TU per platform -- the same pick the build driver makes.
const POLLER = join(
  srcDir,
  process.platform === "win32"
    ? "scr_loop_wsapoll.c"
    : process.platform === "darwin"
      ? "scr_loop_kqueue.c"
      : "scr_loop_epoll.c",
);

test.skipIf(!enabled)("scr_ws_client round-trips over a real socket", async () => {
  const buildDir = join(testDir, "build");
  await mkdir(buildDir, { recursive: true });
  const bin = testBin(buildDir, "test_ws_client");
  await ccCompile([
    "-std=c11", "-O1", "-Wall", "-Wextra",
    "-I", srcDir,
    ...(process.platform === "linux" ? ["-D_GNU_SOURCE"] : []),
    "-o", bin,
    join(testDir, "test_ws_client.c"),
    ...SOURCES, POLLER,
    ...(process.platform === "linux" ? ["-lm"] : []),
  ]);

  const server = spawn(process.execPath, [join(testDir, "ws_echo_server.mjs")]);
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("echo server timeout")), 8000);
    let out = "";
    server.stdout.on("data", (d: Buffer) => {
      out += d.toString();
      const m = out.match(/PORT (\d+)/);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    server.on("error", reject);
  });

  try {
    const { stderr } = await execFileAsync(bin, [String(port)]);
    expect(stderr.trim()).toBe("7/7 checks passed");
  } finally {
    server.kill();
  }
});
