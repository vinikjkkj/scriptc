// keepAliveTimeout 200: after a keep-alive response the socket's idle clock is the
// keep-alive timeout plus Node's 1000 ms buffer; the idle socket is then destroyed
// (no 'timeout' listener handles it). The Keep-Alive header carries whole seconds.
import * as http from "http";
import * as net from "net";
const srv = http.createServer({ keepAliveTimeout: 200 }, (q, s) => { s.end("ok"); });
console.log("keepAliveTimeout", srv.keepAliveTimeout);
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  const c = net.connect(port, "127.0.0.1", () => c.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n"));
  let got = "";
  c.on("data", (d) => { got += d.toString("latin1"); });
  c.on("close", () => {
    console.log(JSON.stringify(got.split("\r\n").filter((l) => /Keep-Alive|Connection/.test(l))));
    srv.close();
  });
  c.on("error", (e: any) => console.log("client error", e.code));
});
