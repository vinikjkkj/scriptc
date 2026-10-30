// The handler sends its head and a chunk before the body finishes; requestTimeout
// then destroys the socket without a 408 (Node writes 408 only with no head out).
import * as http from "http";
import * as net from "net";
const srv = http.createServer({ headersTimeout: 200, requestTimeout: 300, connectionsCheckingInterval: 50 }, (q, s) => {
  s.write("part");
});
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  const c = net.connect(port, "127.0.0.1", () => c.write("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 10\r\n\r\nab"));
  let got = "";
  c.on("data", (d) => { got += d.toString("latin1"); });
  c.on("close", () => {
    console.log("status", got.split("\r\n")[0], "has408", got.includes("408"), "chunk", got.includes("4\r\npart\r\n"));
    srv.close(() => console.log("server closed"));
  });
});
