// socket.setTimeout(0, callback) disables the timer and registers nothing:
// Node's msecs === 0 branch removes the listener instead of adding it.
import * as net from "net";

const srv = net.createServer((c) => {
  c.on("error", () => {});
});
srv.listen(0, "127.0.0.1", () => {
  const port = (srv.address() as any).port;
  const s = net.connect(port, "127.0.0.1", () => {
    s.setTimeout(0, () => console.log("must not fire"));
    setTimeout(() => {
      console.log("quiet");
      s.destroy();
      srv.close();
    }, 120);
  });
  s.on("error", (e: any) => console.log("error", e.code));
});
