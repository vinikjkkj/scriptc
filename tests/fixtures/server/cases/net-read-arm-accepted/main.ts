/* The same rule on the ACCEPTED side: a connection whose handler asks for
 * no data still notices the client's FIN.
 *
 * Node's accepted-socket constructor ends with this.read(0) unless
 * pauseOnConnect, which is a SECOND call site from the client's
 * afterConnect -- arming the client alone leaves this program hanging, so
 * it is its own witness. scr_net_server_accept now calls update_read once
 * the 'connection' listeners have had their say. Driver-less. */
import * as net from "node:net";

const srv = net.createServer((s: net.Socket) => {
  s.on("end", () => console.log("srv-sock end"));
  s.on("close", () => { console.log("srv-sock close"); srv.close(() => console.log("srv close")); });
});
srv.listen(0, () => {
  const c = net.connect({ port: srv.address().port }, () => { console.log("connected"); c.end(); });
  c.on("close", () => console.log("client close"));
});
