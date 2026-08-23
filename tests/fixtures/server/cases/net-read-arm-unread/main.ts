/* THE GUARD, first half: watching a consumer-less socket must not CONSUME
 * from it.
 *
 * Bytes arrive before any listener exists. Node leaves them in its own
 * readable buffer; this runtime leaves them in the kernel's. Either way a
 * 'data' listener added later must find every one of them. An arming fix
 * that read the socket and dropped what nobody wanted would print "total
 * 0" here and stay green everywhere else -- a silent wrong answer where
 * there used to be a right one, which is worse than the hang it replaced.
 * This case is MATCH on main and must stay MATCH. Driver-less. */
import * as net from "node:net";

const srv = net.createServer((s: net.Socket) => {
  s.write("A".repeat(1000));
  setTimeout(() => { s.end(); }, 300);
});
srv.listen(0, () => {
  const c = net.connect({ port: srv.address().port }, () => {
    console.log("connected");
    setTimeout(() => {
      let n = 0;
      c.on("data", (b: Buffer) => { n += b.length; });
      c.on("end", () => console.log("total " + n));
      c.on("close", () => { console.log("client close"); srv.close(() => console.log("srv close")); });
    }, 150);
  });
});
