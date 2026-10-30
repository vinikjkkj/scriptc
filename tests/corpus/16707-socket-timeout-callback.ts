// socket.setTimeout(ms, callback): the callback is a once('timeout') listener
// armed with the delay. It fires once when the connection goes idle.
import * as net from "net";

const srv = net.createServer((c) => {
  c.on("error", () => {});
});
srv.listen(0, "127.0.0.1", () => {
  const port = (srv.address() as any).port;
  const s = net.connect(port, "127.0.0.1", () => {
    console.log("connected");
    s.setTimeout(50, () => {
      console.log("idle callback");
      s.destroy();
      srv.close();
    });
  });
  s.on("error", (e: any) => console.log("error", e.code));
});
