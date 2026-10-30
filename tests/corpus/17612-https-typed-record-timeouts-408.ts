// The same timeouts reach https.createServer through a typed options record
// (the runtime-walked form): the stalled TLS client gets the 408 and the close.
import * as fs from "fs";
import * as https from "https";
import * as tls from "tls";
const opts = {
  key: fs.readFileSync("tests/fixtures/server/certs/localhost-key.pem"),
  cert: fs.readFileSync("tests/fixtures/server/certs/localhost.pem"),
  headersTimeout: 300,
  requestTimeout: 1000,
  connectionsCheckingInterval: 50,
};
const srv = https.createServer(opts, (q, s) => { s.end("ok"); });
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
