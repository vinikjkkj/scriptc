/* The tick queue drains BETWEEN two close callbacks, and both servers get
 * in before the second socket.
 *
 * Two clients destroyed in one turn. y is the self socket, so its 'close'
 * runs an iteration ahead; its handler destroys the last connection of a
 * closing server, whose tick fires before the next close callback. The
 * OTHER server drains in the poll phase of that same later iteration, so
 * it too lands ahead of x:
 *
 *   y closed / srv closed / plain closed / x closed
 *
 * Main prints x first (registry order beats everything) and puts both
 * servers after both sockets:
 *
 *   x closed / y closed / srv closed / plain closed
 *
 * The plain server's handler calls resume() on purpose. Without it this
 * fixture HANGS -- on main and on this branch alike -- because
 * scr_net_sock_update_read arms a socket's read only when it has a
 * consumer, so an accepted socket nobody reads never sees its peer's FIN,
 * never closes, and never drains its server. Node's afterConnect calls
 * read(0) whenever readableFlowing is not false, so it notices. That is a
 * separate defect with its own queue and it is NOT fixed here; the
 * resume() is what keeps this fixture measuring close ORDER instead of
 * that. Driver-less. */
import * as net from "node:net";

let held: net.Socket | null = null;
const srv = net.createServer((s: net.Socket) => { held = s; });
const plain = net.createServer((s: net.Socket) => { s.resume(); });

srv.listen(0, () => {
  plain.listen(0, () => {
    const x = net.connect({ port: plain.address().port }, () => {
      const y = net.connect({ port: srv.address().port }, () => {
        x.on("close", () => console.log("x closed"));
        y.on("close", () => {
          console.log("y closed");
          if (held !== null) held.destroy();
        });
        srv.close(() => console.log("srv closed"));
        plain.close(() => console.log("plain closed"));
        x.destroy();
        y.destroy();
      });
    });
  });
});
