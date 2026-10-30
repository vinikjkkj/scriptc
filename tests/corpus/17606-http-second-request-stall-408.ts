// Keep-alive: the first request completes normally, then a second request's head
// stalls. Its clock starts at its first byte, so headersTimeout answers 408 to it.
import * as http from "http";
import * as net from "net";
const srv = http.createServer({ headersTimeout: 200, requestTimeout: 1000, connectionsCheckingInterval: 50 }, (q, s) => { s.end("ok:" + q.url); });
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  const c = net.connect(port, "127.0.0.1", () => {
    c.write("GET /one HTTP/1.1\r\nHost: x\r\n\r\n");
    setTimeout(() => c.write("GET /two HTTP/1.1\r\nHost: x\r\n"), 400);
  });
  let got = "";
  c.on("data", (d) => { got += d.toString("latin1"); });
  c.on("close", () => {
    console.log("ok:/one", got.includes("ok:/one"), "408", got.includes("HTTP/1.1 408 Request Timeout\r\nConnection: close\r\n\r\n"), "no ok:/two", !got.includes("ok:/two"));
    srv.close(() => console.log("server closed"));
  });
});
