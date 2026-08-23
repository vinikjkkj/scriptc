/* The socket whose 'close' is the thing that drains the last server: the
 * client's close handler destroys the held server-side connection, so the
 * server only becomes due DURING the close phase.
 *
 * Node runs the tick queue between close callbacks, so the server's
 * 'close' lands right after the socket's:
 *
 *   client closed / srv closed
 *
 * Held as a non-regression pin. It passed before the close phase existed
 * and it has to keep passing: what it catches is a close phase that
 * forgets to drain the due queue at all, which would print "srv closed"
 * only at the next sweep -- or never, if nothing else woke the loop.
 * Driver-less. */
import * as net from "node:net";

let held: net.Socket | null = null;
const srv = net.createServer((s: net.Socket) => { held = s; });
srv.listen(0, () => {
  const c = net.connect({ port: srv.address().port }, () => {
    c.on("close", () => {
      console.log("client closed");
      if (held !== null) held.destroy();
    });
    srv.close(() => console.log("srv closed"));
    c.destroy();
  });
});
