/* A server closed while a client socket is still DRAINING -- the guard
 * against over-applying the phase rule.
 *
 * Node's tick queue outruns the close phase, but only inside ONE loop
 * iteration. Here the client reads its peer's FIN, ends, and is destroyed
 * in one iteration, while the server-side socket reads the CLIENT's FIN in
 * a later one and drains the closing server. So the socket's 'close' comes
 * first: it belonged to the earlier iteration's close phase, when the
 * server's tick had not been scheduled yet.
 *
 *   client end bytes=200000 / client closed / srv closed
 *
 * This runtime often sees both readiness events in ONE poller drain, so a
 * settle at the sweep head with no notion of iteration prints "srv closed"
 * first. scr_net_epoch is what keeps the two apart, and this fixture is
 * why it exists: the first shape of that fix reversed these two lines on
 * every run while every other close-order case passed, and it was a
 * MATCH-to-WRONG that nothing else in the suite would have caught.
 *
 * The 200 KB is deliberate: the server socket's write is still draining
 * when close() is called. Driver-less. */
import * as net from "node:net";

const srv = net.createServer((s: net.Socket) => {
  s.on("data", () => {});
  s.write("x".repeat(200000));
  s.end();
});
srv.listen(0, () => {
  const c = net.connect({ port: srv.address().port }, () => {
    let n = 0;
    c.on("data", (d: Buffer) => { n += d.length; });
    c.on("end", () => console.log("client end bytes=" + n));
    c.on("close", () => console.log("client closed"));
    srv.close(() => console.log("srv closed"));
    c.write("hello");
    c.end();
  });
});
