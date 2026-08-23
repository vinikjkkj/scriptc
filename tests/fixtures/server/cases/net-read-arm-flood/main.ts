/* THE GUARD, second half: a FIN behind bytes nobody read must NOT be seen.
 *
 * A megabyte and then end(). Node reads into its readable buffer only up
 * to the high-water mark and then stops, so it never reaches the FIN
 * behind that megabyte: the 400ms timer fires FIRST and 'close' only
 * follows the destroy. A fix that armed the read and drained to EOF would
 * print "client close" before "tick" -- back-pressure gone, and a
 * divergence in the opposite direction from the hang. The peek reads
 * nothing, so the order holds. MATCH on main, must stay MATCH.
 * Driver-less. */
import * as net from "node:net";

const srv = net.createServer((s: net.Socket) => {
  s.on("error", () => {});
  s.write("a".repeat(1048576));
  s.end();
});
srv.listen(0, () => {
  const c = net.connect({ port: srv.address().port }, () => {
    console.log("connected");
    c.on("close", () => { console.log("client close"); srv.close(() => console.log("srv close")); });
    setTimeout(() => { console.log("tick"); c.destroy(); }, 400);
  });
});
