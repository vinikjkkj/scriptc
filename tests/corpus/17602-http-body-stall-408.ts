// The head is complete and the handler runs, but the body stalls: headersTimeout
// (200) no longer applies, and requestTimeout (400) answers 408. The handler's
// start is printed before the 408.
import * as http from "http";
import * as net from "net";
const srv = http.createServer({ headersTimeout: 200, requestTimeout: 400, connectionsCheckingInterval: 50 }, (q, s) => {
  console.log("handler", q.method, q.headers["content-length"]);
  s.end("never");
});
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  const c = net.connect(port, "127.0.0.1", () => c.write("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 10\r\n\r\nab"));
  let got = "";
  c.on("data", (d) => { got += d.toString("latin1"); });
  c.on("close", () => {
    console.log(JSON.stringify(got.replace(/Date: [^\r]*\r\n/, "")));
    srv.close(() => console.log("server closed"));
  });
});
