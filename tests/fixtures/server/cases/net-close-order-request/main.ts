/* The control for net-close-order-drained: three servers that are ALL
 * drained when close() runs, closed in a deliberately non-registry order.
 *
 * Every one of them becomes due inside its own close(), so due order and
 * close-REQUEST order coincide and Node emits 'close' in call order —
 * s3, s1, s2. This is the case the settle queue's ordering was originally
 * written for (the wrapper-closes-inner idiom), and it must keep behaving
 * exactly as it did: an ordering fix for the busy/drained case that
 * reordered THIS one would be a new wrong answer, not a fix. Driver-less. */
import * as net from "node:net";

const s1 = net.createServer(() => {});
const s2 = net.createServer(() => {});
const s3 = net.createServer(() => {});

s1.listen(0, () => {
  s2.listen(0, () => {
    s3.listen(0, () => {
      console.log("all listening");
      s3.close(() => console.log("s3 closed"));
      s1.close(() => console.log("s1 closed"));
      s2.close(() => console.log("s2 closed"));
    });
  });
});
