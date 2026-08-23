/* The sharp edge of the same rule, well UNDER any buffer size: one
 * thousand bytes and then end(), with nothing consuming.
 *
 * Node's readable side does not end while unread bytes sit in front of the
 * FIN -- measured on the oracle: readableEnded stays false, no 'end', no
 * 'close', and the process would hang if the timer did not destroy the
 * socket. So "tick" prints first here too. This is what separates a PEEK
 * from a read-and-buffer-to-the-mark: 1000 bytes fit under Node's 16 KiB
 * mark, so a fix that buffered to the mark WOULD reach the FIN and would
 * print "client close" first. Driver-less. */
import * as net from "node:net";

const srv = net.createServer((s: net.Socket) => {
  s.on("error", () => {});
  s.write("A".repeat(1000));
  s.end();
});
srv.listen(0, () => {
  const c = net.connect({ port: srv.address().port }, () => {
    console.log("connected");
    c.on("end", () => console.log("client end"));
    c.on("close", () => { console.log("client close"); srv.close(() => console.log("srv close")); });
    setTimeout(() => { console.log("tick"); c.destroy(); }, 400);
  });
});
