/* Two BUSY servers drained in one turn, and a drained one closed between
 * them. The probe the block that landed 2a7575e3 left behind, because main
 * and its branch were BOTH wrong on it.
 *
 * Node's boundary between a server's 'close' and a socket's 'close' is an
 * event-loop PHASE boundary. Socket._destroy runs the server's
 * _connections-- and _emitCloseIfDrained() on the destroying stack, so the
 * server's 'close' is a process.nextTick; the socket's own 'close' is a
 * libuv close callback and waits for the close phase, which the whole tick
 * queue outruns. A turn that destroys two connections and drains two
 * servers therefore prints BOTH server closes and only then the two socket
 * closes:
 *
 *   idle closed / a closed / b closed / cb closed / ca closed
 *
 * This runtime dropped the connection count in the sweep's close-EMISSION
 * branch, which made each server become due exactly when its socket's
 * 'close' was already being delivered, so the two queues interleaved:
 *
 *   idle closed / ca closed / a closed / cb closed / b closed
 *
 * on every run, on both backends. The last two lines are the other half:
 * Node's close phase is LIFO by destroy order, and cb was destroyed after
 * ca. Driver-less: it drives itself and self-terminates. */
import * as net from "node:net";

const idle = net.createServer(() => { console.log("idle conn"); });
let ha: net.Socket | null = null;
let hb: net.Socket | null = null;
const a = net.createServer((s: net.Socket) => { ha = s; });
const b = net.createServer((s: net.Socket) => { hb = s; });

a.listen(0, () => {
  b.listen(0, () => {
    idle.listen(0, () => {
      const ca = net.connect({ port: a.address().port }, () => {
        const cb = net.connect({ port: b.address().port }, () => {
          ca.on("close", () => { console.log("ca closed"); });
          cb.on("close", () => { console.log("cb closed"); });
          a.close(() => console.log("a closed"));
          idle.close(() => console.log("idle closed"));
          b.close(() => console.log("b closed"));
          ca.destroy();
          cb.destroy();
          if (ha !== null) ha.destroy();
          if (hb !== null) hb.destroy();
        });
      });
    });
  });
});
