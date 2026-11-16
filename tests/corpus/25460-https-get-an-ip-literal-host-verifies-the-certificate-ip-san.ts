// https.get to an IP-LITERAL host with a verifying client: the chain is checked against the `ca` and the address against the certificate's
// IP SAN (mbedTLS has no IP matching; the runtime runs Node's checkServerIdentity itself). Before: every such dial died `client TLS handshake failed`.
import * as fs from "fs";
import * as Https from "https";
const key = fs.readFileSync("tests/fixtures/server/certs/localhost-key.pem");
const cert = fs.readFileSync("tests/fixtures/server/certs/localhost.pem");
const ca = fs.readFileSync("tests/fixtures/server/certs/ca.pem");
const srv = Https.createServer({ key, cert }, (_req, res) => { res.end("hello over tls"); });
srv.listen(0, "127.0.0.1", () => {
  const port = (srv.address() as any).port;
  const req = Https.get({ host: "127.0.0.1", port, path: "/", ca }, (res) => {
    let body = "";
    res.on("data", (c) => { body += String(c); });
    res.on("end", () => { console.log("response", res.statusCode, body); srv.close(); });
  });
  req.on("error", (e) => { console.log("request error", (e as any).code, e.message); srv.close(); });
});
