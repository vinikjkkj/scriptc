// headersTimeout 300 with a stalled head: the server answers the default 408
// (no clientError listener) and destroys the socket. The stalled client gets the
// exact bytes, then 'close'. Times are not printed (the grid is 50 ms).
import * as http from "http";
import * as net from "net";
const srv = http.createServer({ headersTimeout: 300, requestTimeout: 1000, connectionsCheckingInterval: 50 }, (q, s) => { s.end("ok"); });
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  const c = net.connect(port, "127.0.0.1", () => c.write("GET / HTTP/1.1\r\nHost: x\r\n"));
  let got = "";
  c.on("data", (d) => { got += d.toString("latin1"); });
  c.on("error", (e: any) => console.log("client error", e.code));
  c.on("close", () => {
    console.log(JSON.stringify(got));
    srv.close(() => console.log("server closed"));
  });
});
