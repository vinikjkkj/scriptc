// A bad delay throws before the callback is registered: the callback never
// fires, even on a connection that would otherwise go idle.
import * as net from "net";

const srv = net.createServer((c) => {
  c.on("error", () => {});
});
srv.listen(0, "127.0.0.1", () => {
  const port = (srv.address() as any).port;
  const s = net.connect(port, "127.0.0.1", () => {
    try {
      s.setTimeout(-1, () => console.log("must not fire"));
      console.log("no throw");
    } catch (e: any) {
      console.log("THROW", e.name, e.code, JSON.stringify(e.message));
    }
    setTimeout(() => {
      console.log("quiet");
      s.destroy();
      srv.close();
    }, 80);
  });
  s.on("error", (e: any) => console.log("error", e.code));
});
