/* A socket destroyed while ITS OWN event is being delivered closes a whole
 * ITERATION ahead of everything else the same turn destroyed -- not merely
 * first in the same batch, and the difference shows whenever the poll in
 * between produces anything.
 *
 * Three clients destroyed inside s1's own 'data' handler, with the server
 * closed in that handler too. Node prints
 *
 *   s1 data / s1 closed / srv closed / s2 closed / s0 closed
 *
 * The server drains in the poll phase BETWEEN s1's close and the other
 * two. (On win32 uv_tcp_close runs a handle's endgame only once its
 * overlapped requests have completed: the socket whose read completion
 * just fired has none left, while the others wait for their cancelled
 * reads to come back.)
 *
 * Before the close phase this runtime printed s0, s1, s2 in registry order
 * with "srv closed" last; a phase that merely put the self socket first
 * within one batch printed s1, s2, s0, srv. Both wrong, on both backends.
 * Driver-less. */
import * as net from "node:net";

const srv = net.createServer((s: net.Socket) => {
  s.on("data", (d: Buffer) => { s.write(d); });
});
srv.listen(0, () => {
  const p = srv.address().port;
  const s0 = net.connect({ port: p }, () => {
    const s1 = net.connect({ port: p }, () => {
      const s2 = net.connect({ port: p }, () => {
        s0.on("close", () => console.log("s0 closed"));
        s1.on("close", () => console.log("s1 closed"));
        s2.on("close", () => console.log("s2 closed"));
        s1.on("data", () => {
          console.log("s1 data");
          s0.destroy();
          s1.destroy();
          s2.destroy();
          srv.close(() => console.log("srv closed"));
        });
        s1.write("go");
      });
    });
  });
});
