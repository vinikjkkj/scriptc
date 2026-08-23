/* An explicitly PAUSED socket is watched by nothing, and that is Node.
 *
 * pause() before anything else: the peer ends immediately, and Node still
 * emits no 'end' -- a paused stream does not read, so it does not reach
 * the FIN. The program is alive at 400ms and only the destroy closes it.
 * The consumer-less peek must respect user_paused exactly as the consumer
 * arming already did; without that guard this case would close early and
 * print in the wrong order. MATCH on main, must stay MATCH. Driver-less. */
import * as net from "node:net";

const srv = net.createServer((s: net.Socket) => { s.on("error", () => {}); s.end(); });
srv.listen(0, () => {
  const c = net.connect({ port: srv.address().port }, () => {
    console.log("connected");
    c.pause();
    c.on("end", () => console.log("client end"));
    c.on("close", () => { console.log("client close"); srv.close(() => console.log("srv close")); });
    setTimeout(() => { console.log("alive at 400ms"); c.destroy(); }, 400);
  });
});
