/* The shutdown close-ORDER a busy server and a drained one settle in.
 *
 * `busy` still holds a connection when close() runs, so its 'close' has to
 * wait for that socket. `idle` is already drained, so Node's
 * _emitCloseIfDrained schedules its 'close' on a NEXT TICK — it lands
 * before any further I/O is delivered, which is why Node prints
 * "idle closed" FIRST even though busy.close() was called after it and
 * even though a client socket's 'close' is already queued.
 *
 * This runtime polls the settle out of the net sweep instead. Settling
 * only at the END of the sweep put "idle closed" after every socket the
 * pass touched — after the client socket's 'close', and after `busy`
 * settled through the socket-close path. This fixture is the DETERMINISTIC
 * witness of that: it printed the three lines in exactly reverse order on
 * every run before the fix.
 *
 * Its rate-carrying cousin is http-proxy-pipe, which wears the same defect
 * as an intermittent: there, whether the proxy's own connection died in
 * the same sweep pass as the backend's pending settle decided the order,
 * so the reversal came out at a rate rather than always. A fixture that
 * reverses ALWAYS is the one worth owning — see shutdown-close-order.test.ts
 * for the rate half. Driver-less: it drives itself and self-terminates. */
import * as net from "node:net";

const idle = net.createServer(() => {
  console.log("idle conn");
});
let held: net.Socket | null = null;
const busy = net.createServer((sock: net.Socket) => {
  held = sock;
});

busy.listen(0, () => {
  idle.listen(0, () => {
    const c = net.connect({ port: busy.address().port }, () => {
      c.on("close", () => {
        console.log("client socket closed");
        if (held !== null) held.destroy();
      });
      idle.close(() => console.log("idle closed"));
      busy.close(() => console.log("busy closed"));
      c.destroy();
    });
  });
});
