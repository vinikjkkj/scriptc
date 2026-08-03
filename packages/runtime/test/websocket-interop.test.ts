import { execFile, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const testDir = import.meta.dirname;

/* End-to-end interop: the scr_ws_conn state machine, over a real blocking
 * TCP socket, handshakes with a genuine `ws` echo server and exchanges
 * masked frames — proving the client's Upgrade REQUEST is accepted by the
 * reference implementation and its frames decode there (the direction the
 * offline vector tests cannot cover).
 *
 * This needs a C compiler, a live localhost server, and the `ws` package,
 * so it is OPT-IN: set RUN_WS_INTEROP=1 (and have `ws` resolvable) to run
 * it. It is skipped by default so CI without those never flakes. Verified
 * on Windows (winsock) with gcc; the client is portable to BSD sockets. */

function wsResolvable(): boolean {
  try {
    createRequire(join(testDir, "ws_echo_server.mjs")).resolve("ws");
    return true;
  } catch {
    return false;
  }
}

const enabled = process.env.RUN_WS_INTEROP === "1" && wsResolvable();

test.skipIf(!enabled)("scr_ws_conn interoperates with a real ws echo server", async () => {
  const buildDir = join(testDir, "build");
  await mkdir(buildDir, { recursive: true });
  const bin = join(buildDir, "test_websocket_interop");
  const socketLib = process.platform === "win32" ? ["-lws2_32"] : [];
  await execFileAsync("clang", [
    "-std=c11", "-O2",
    "-o", bin,
    join(testDir, "test_websocket_interop.c"),
    join(testDir, "../src/scr_websocket.c"),
    ...socketLib,
  ]);

  // Start the echo server and capture the bound port from its stdout.
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
    expect(stderr).toContain("INTEROP OK");
  } finally {
    server.kill();
  }
});
