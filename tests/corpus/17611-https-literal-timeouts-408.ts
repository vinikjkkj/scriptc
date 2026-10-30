// https.createServer takes the http connection timeouts: a TLS client that sends
// a partial head gets the 408 over TLS (headersTimeout 300) and the socket closes.
import * as fs from "fs";
import * as https from "https";
import * as tls from "tls";
const key = fs.readFileSync("tests/fixtures/server/certs/localhost-key.pem");
const cert = fs.readFileSync("tests/fixtures/server/certs/localhost.pem");
const srv = https.createServer({ key, cert, headersTimeout: 300, requestTimeout: 1000, connectionsCheckingInterval: 50 }, (q, s) => { s.end("ok"); });
srv.listen(0, "127.0.0.1", () => {
  const port = (srv.address() as any).port;
  const c = tls.connect({ host: "127.0.0.1", port, rejectUnauthorized: false }, () => c.write("GET / HTTP/1.1\r\nHost: x\r\n"));
  let got = "";
  c.on("data", (d) => { got += d.toString("latin1"); });
  c.on("error", () => {});
  c.on("close", () => {
    console.log(JSON.stringify(got));
    srv.close(() => console.log("server closed"));
  });
});
