// A DNS host the certificate does not cover (the cert names alt.localhost, the dial is to localhost): Node's ERR_TLS_CERT_ALTNAME_INVALID
// with its `Host: localhost. is not in the cert's altnames: DNS:alt.localhost` reason, raised on the request's 'error'.
import * as fs from "fs";
import * as Https from "https";
const key = fs.readFileSync("tests/fixtures/server/certs/alt-key.pem");
const cert = fs.readFileSync("tests/fixtures/server/certs/alt.pem");
const ca = fs.readFileSync("tests/fixtures/server/certs/ca.pem");
const srv = Https.createServer({ key, cert }, (_req, res) => { res.end("never"); });
srv.listen(0, "127.0.0.1", () => {
  const port = (srv.address() as any).port;
  const req = Https.get({ host: "localhost", port, path: "/", ca }, () => { console.log("unexpected response"); srv.close(); });
  req.on("error", (e) => {
    const x = e as any;
    console.log("error", x.code, "|", e.message);
    console.log("reason", x.reason, "| host", x.host);
    srv.close();
  });
});
