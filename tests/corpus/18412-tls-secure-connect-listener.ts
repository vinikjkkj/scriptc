// A 'secureConnect' listener on the TLS client socket (the tls.sockOnSecureConnect
// row), registered with once(): it fires exactly once after the handshake.
import { readFileSync } from "node:fs";
import * as tls from "node:tls";

const key = readFileSync("tests/fixtures/server/certs/localhost-key.pem", "utf8");
const cert = readFileSync("tests/fixtures/server/certs/localhost.pem", "utf8");
const srv = tls.createServer({ key, cert }, (s) => { s.end("hi"); });
srv.listen(0, () => {
  const port = (srv.address() as any).port;
  const c = tls.connect({ host: "localhost", port, rejectUnauthorized: false });
  c.once("secureConnect", () => {
    console.log("secureConnect fired");
    c.destroy();
    srv.close();
  });
});
