import * as http from "http";
import * as net from "net";
const srv = http.createServer((q, s) => { s.end("ok"); });
srv.timeout = 60;
console.log("timeout prop", srv.timeout);
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  const c = net.connect(port, "127.0.0.1", () => console.log("client connected"));
  c.on("end", () => console.log("client end"));
  c.on("close", () => { console.log("client closed"); srv.close(); });
  c.on("error", (e: any) => console.log("client err", e.code));
});
