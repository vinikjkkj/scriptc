/* net-close-order-tick-between with the resume() taken back out -- the
 * result the read-arming defect was hiding.
 *
 * Its sibling's header records why that resume() had to be there: the
 * plain server's accepted socket had no consumer, so it was never watched,
 * never saw its peer's FIN, and the program HUNG on both sides. 5/5 hangs
 * on main. The block that wrote the sibling called the un-resumed shape
 * unreachable, because it needs the accepted socket to notice the peer
 * within the same loop iteration Node does -- not merely eventually.
 *
 * It does. With the consumer-less peek in scr_net_sock_update_read this
 * prints Node's four lines in Node's order, 5/5:
 *
 *   y closed / srv closed / plain closed / x closed
 *
 * which makes this the sharpest witness of the pair. The two arming
 * fixtures prove a FIN is seen at all; this one proves it is seen in the
 * right iteration, with three other close events queued around it. The
 * sibling keeps its resume() -- it is pinned in the 15-run close-order net
 * and must go on measuring exactly what it measured before. Driver-less. */
import * as net from "node:net";

let held: net.Socket | null = null;
const srv = net.createServer((s: net.Socket) => { held = s; });
const plain = net.createServer((s: net.Socket) => { void s; });

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
