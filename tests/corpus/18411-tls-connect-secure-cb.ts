// tls.connect with a secureConnect callback (the tls.connectCb row): the
// callback fires once the handshake completes, after the TLS client socket
// is connected. Verification is off for the self-signed fixture.
import { readFileSync } from "node:fs";
import * as tls from "node:tls";

const key = readFileSync("tests/fixtures/server/certs/localhost-key.pem", "utf8");
const cert = readFileSync("tests/fixtures/server/certs/localhost.pem", "utf8");
const srv = tls.createServer({ key, cert }, (s) => { s.end("hi"); });
srv.listen(0, () => {
  const port = (srv.address() as any).port;
  const c = tls.connect(port, "localhost", { rejectUnauthorized: false }, () => {
    console.log("connected", c.authorized);
    c.destroy();
    srv.close();
  });
});
