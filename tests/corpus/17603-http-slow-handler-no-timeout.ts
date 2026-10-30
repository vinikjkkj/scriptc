// A complete request whose handler answers late: the message is complete, so
// requestTimeout (300) does not apply while the handler runs. The late answer arrives.
import * as http from "http";
import * as net from "net";
const srv = http.createServer({ headersTimeout: 200, requestTimeout: 300, connectionsCheckingInterval: 50 }, (q, s) => {
  setTimeout(() => s.end("late"), 700);
});
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  const c = net.connect(port, "127.0.0.1", () => c.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"));
  let got = "";
  c.on("data", (d) => { got += d.toString("latin1"); });
  c.on("close", () => {
    console.log(got.includes("408 Request") ? "timed out" : "no 408", JSON.stringify(got.slice(-6)));
    srv.close(() => console.log("server closed"));
  });
});
