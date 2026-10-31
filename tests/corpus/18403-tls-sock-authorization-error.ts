// The TLS client socket's `authorizationError` on secureConnect, read with
// verification on and off. Verification is off here, so the value is the
// verify-failure code string for the self-signed chain (Node's value shape).
import { readFileSync } from "node:fs";
import * as tls from "node:tls";

const key = readFileSync("tests/fixtures/server/certs/localhost-key.pem", "utf8");
const cert = readFileSync("tests/fixtures/server/certs/localhost.pem", "utf8");
const srv = tls.createServer({ key, cert }, (s) => { s.end("hi"); });
srv.listen(0, () => {
  const port = (srv.address() as any).port;
  const c = tls.connect({ host: "localhost", port, rejectUnauthorized: false });
  c.on("secureConnect", () => {
    const e = c.authorizationError;
    console.log("authorizationError", e === null ? "null" : e);
    c.destroy();
    srv.close();
  });
});
