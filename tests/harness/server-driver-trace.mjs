/* Diagnostic preload for the server differential's DRIVER process (the
 * node.exe that tests/harness/server.test.ts spawns to talk to a fixture).
 * Loaded with `node --import`. It writes one line per net/tls socket event,
 * destroy/end call and process exit to fd 2 with fs.writeSync, so the last
 * line before a fast-fail (Windows 0xC0000409) survives: an async pipe write
 * would be lost with the process. It changes no behaviour: it only observes
 * emit/destroy/end, and uncaughtExceptionMonitor does not catch anything.
 * Driver stderr is never compared, so these lines never reach a verdict
 * except inside the failure message the harness prints. */
import { writeSync } from "node:fs";
import { Socket } from "node:net";

const t0 = performance.now();
function trace(line) {
  try {
    writeSync(2, `[driver-trace +${(performance.now() - t0).toFixed(1)}ms pid ${process.pid}] ${line}\n`);
  } catch {
    // fd 2 closed: nothing to report to.
  }
}

const emit = Socket.prototype.emit;
Socket.prototype.emit = function (ev, ...args) {
  if (ev === "error") {
    const e = args[0];
    trace(`socket error ${e?.code ?? "-"} ${e?.message ?? ""}`);
  } else if (ev === "data") {
    trace(`socket data ${args[0]?.length ?? "?"} bytes`);
  } else {
    trace(`socket ${ev}`);
  }
  return emit.apply(this, [ev, ...args]);
};

const destroy = Socket.prototype.destroy;
Socket.prototype.destroy = function (err) {
  trace(`socket destroy${err ? ` with ${err.code ?? err.message}` : ""}`);
  return destroy.call(this, err);
};

const end = Socket.prototype.end;
Socket.prototype.end = function (...args) {
  trace(`socket end (writable ${this.writable}, destroyed ${this.destroyed})`);
  return end.apply(this, args);
};

process.on("uncaughtExceptionMonitor", (err) => trace(`uncaught ${err?.code ?? "-"} ${err?.message ?? err}`));
process.on("exit", (code) => trace(`process exit code ${code}`));
trace("driver start");
