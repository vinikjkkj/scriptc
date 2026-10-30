import * as http from "http";
import * as net from "net";
const srv = http.createServer((q, s) => { s.end("ok"); });
let fires = 0;
const r = srv.setTimeout(60, () => { fires++; console.log("server cb fired", fires); });
console.log("chain same", r === srv);
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  const c = net.connect(port, "127.0.0.1", () => console.log("client connected"));
  c.on("close", () => { console.log("client closed"); srv.close(); });
  c.on("error", (e: any) => console.log("client err", e.code));
  setTimeout(() => { console.log("fires before destroy", fires); c.destroy(); }, 250);
});
