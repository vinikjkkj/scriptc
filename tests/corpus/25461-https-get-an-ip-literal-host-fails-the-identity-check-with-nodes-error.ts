// The certificate has a DNS SAN only, the dial is to an IP literal: Node fails AFTER the handshake, on the request's 'error', with
// ERR_TLS_CERT_ALTNAME_INVALID (message, code, reason, host). The runtime's message, code and properties must be the same.
import * as fs from "fs";
import * as Https from "https";
const key = fs.readFileSync("tests/fixtures/server/certs/alt-key.pem");
const cert = fs.readFileSync("tests/fixtures/server/certs/alt.pem");
const ca = fs.readFileSync("tests/fixtures/server/certs/ca.pem");
const srv = Https.createServer({ key, cert }, (_req, res) => { res.end("never"); });
srv.listen(0, "127.0.0.1", () => {
  const port = (srv.address() as any).port;
  const req = Https.get({ host: "127.0.0.1", port, path: "/", ca }, (res) => {
    console.log("unexpected response", res.statusCode);
    srv.close();
  });
  req.on("error", (e) => {
    const x = e as any;
    console.log("error", x.code, "|", e.message);
    console.log("reason", x.reason, "| host", x.host);
    console.log(e instanceof Error, e.name);
    srv.close();
  });
});
