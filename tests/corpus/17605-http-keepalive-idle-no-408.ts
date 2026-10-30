// After a complete keep-alive exchange the connection is idle: the request
// clock is stopped, so headersTimeout (200) never answers 408 to it while idle.
import * as http from "http";
import * as net from "net";
const srv = http.createServer({ headersTimeout: 200, requestTimeout: 300, connectionsCheckingInterval: 50 }, (q, s) => { s.end("ok"); });
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  const c = net.connect(port, "127.0.0.1", () => c.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n"));
  let got = "";
  c.on("data", (d) => { got += d.toString("latin1"); });
  setTimeout(() => {
    console.log("idle after 600 ms: has408", got.includes("408"), "has200", got.includes("200 OK"));
    c.destroy();
  }, 600);
  c.on("close", () => srv.close(() => console.log("server closed")));
});
