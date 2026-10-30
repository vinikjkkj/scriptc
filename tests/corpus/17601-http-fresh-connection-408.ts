// A connection that sends nothing is timed from accept (Node measures it like a
// request): headersTimeout 200 answers 408 and closes it.
import * as http from "http";
import * as net from "net";
const srv = http.createServer({ headersTimeout: 200, requestTimeout: 1000, connectionsCheckingInterval: 50 }, (q, s) => { s.end("ok"); });
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  const c = net.connect(port, "127.0.0.1");
  let got = "";
  c.on("data", (d) => { got += d.toString("latin1"); });
  c.on("close", () => {
    console.log(JSON.stringify(got));
    srv.close(() => console.log("server closed"));
  });
});
