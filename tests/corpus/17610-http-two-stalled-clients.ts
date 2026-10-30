// Two stalled clients on one server are both answered 408 by the same sweep.
import * as http from "http";
import * as net from "net";
const srv = http.createServer({ headersTimeout: 200, requestTimeout: 1000, connectionsCheckingInterval: 50 }, (q, s) => { s.end("ok"); });
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  let closed = 0;
  const results: string[] = [];
  for (const tag of ["a", "b"]) {
    const c = net.connect(port, "127.0.0.1", () => c.write("GET / HTTP/1.1\r\nHost: " + tag + "\r\n"));
    let got = "";
    c.on("data", (d) => { got += d.toString("latin1"); });
    c.on("close", () => {
      results.push(got.split("\r\n")[0]);
      if (++closed === 2) {
        console.log(results.join(" | "));
        srv.close(() => console.log("server closed"));
      }
    });
  }
});
