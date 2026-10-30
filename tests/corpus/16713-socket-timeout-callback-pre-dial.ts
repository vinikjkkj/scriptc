// A callback form armed before connect() fires once the dialled connection
// goes idle, like the plain form.
import * as net from "net";

const srv = net.createServer((c) => {
  c.on("error", () => {});
});
srv.listen(0, "127.0.0.1", () => {
  const port = (srv.address() as any).port;
  const s = new net.Socket();
  s.setTimeout(60, () => {
    console.log("pre-dial idle");
    s.destroy();
    srv.close();
  });
  s.connect(port, "127.0.0.1", () => console.log("connected"));
  s.on("error", (e: any) => console.log("error", e.code));
});
