// The 408 fires before server.close(): close() then completes after the
// connection is gone, and the process exits on its own.
import * as http from "http";
import * as net from "net";
const srv = http.createServer({ headersTimeout: 200, requestTimeout: 1000, connectionsCheckingInterval: 50 }, (q, s) => { s.end("ok"); });
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  const c = net.connect(port, "127.0.0.1", () => c.write("GET / HTTP/1.1\r\n"));
  c.on("data", () => {});
  c.on("close", () => {
    console.log("client closed");
    srv.close(() => console.log("server closed"));
  });
});
