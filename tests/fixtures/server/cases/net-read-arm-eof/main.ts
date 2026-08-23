/* A connected socket with NO 'data' listener still notices its peer's FIN.
 *
 * Node's afterConnect calls read(0) whenever readableFlowing is not false,
 * so a socket nobody reads is still watched: the peer's FIN arrives, 'end'
 * and 'close' fire, and the loop drains. Before the peek arming in
 * scr_net_sock_update_read this program HUNG FOREVER on main -- 3/3, not
 * intermittently -- because the socket was never watched at all, so it
 * never left the socket registry and scr_net_pending never went false.
 * A hang is worse than a wrong answer: it scores DID-NOT-RUN and teaches
 * nobody anything, and it masked a close-ordering result in the block
 * before this one. Driver-less. */
import * as net from "node:net";

const srv = net.createServer((s: net.Socket) => { s.end(); });
srv.listen(0, () => {
  const c = net.connect({ port: srv.address().port }, () => {
    console.log("connected");
    c.on("end", () => console.log("client end"));
    c.on("close", () => { console.log("client close"); srv.close(() => console.log("srv close")); });
  });
});
