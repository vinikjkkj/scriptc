// @exit: 1
// server.setTimeout(-1) is stored unvalidated; the first accepted socket throws
// ERR_OUT_OF_RANGE inside the connection handler, uncaught (exit 1, stdout only).
import * as http from "http";
import * as net from "net";
const srv = http.createServer((q, s) => { s.end("ok"); });
srv.setTimeout(-1);
console.log("after setTimeout(-1)");
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  const c = net.connect(port, "127.0.0.1", () => console.log("client connected"));
  c.on("error", (e: any) => console.log("client err", e.code));
  c.on("close", () => { console.log("client closed"); srv.close(); });
});
