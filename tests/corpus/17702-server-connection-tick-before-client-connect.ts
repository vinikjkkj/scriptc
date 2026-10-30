// the server connection callback's tick and job run before the client connect of the same poll batch.
import * as net from "net";
const srv = net.createServer((s) => {
  console.log("server-conn");
  process.nextTick(() => console.log("tick-server-conn"));
  Promise.resolve().then(() => console.log("micro-server-conn"));
  s.end();
});
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  const c = net.createConnection({ port, host: "127.0.0.1" });
  c.on("connect", () => { console.log("client-connect"); });
  c.on("close", () => { console.log("client-close"); srv.close(); });
  c.resume();
});
