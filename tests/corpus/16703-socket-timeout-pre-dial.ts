// A socket's idle timer armed BEFORE connect() fires once the connection is
// idle: Node starts the clock at the setTimeout call. The timer must survive
// until the dial, then fire 'timeout' on the idle connection.
import * as net from "net";

const srv = net.createServer((c) => {
  c.on("error", () => {});
});
srv.listen(0, "127.0.0.1", () => {
  const port = (srv.address() as any).port;
  const s = new net.Socket();
  s.setTimeout(100);
  s.on("timeout", () => {
    console.log("timeout fired");
    s.destroy();
    srv.close();
  });
  s.on("error", (e: any) => console.log("error", e.code));
  s.connect(port, "127.0.0.1", () => {
    console.log("connected");
  });
});
