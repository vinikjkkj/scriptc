// The TLS client socket's `authorized` flag, read on secureConnect. The
// fixture certificate is self-signed, so verification fails and the flag is
// false (rejectUnauthorized is off, so the connection still completes).
import { readFileSync } from "node:fs";
import * as tls from "node:tls";

const key = readFileSync("tests/fixtures/server/certs/localhost-key.pem", "utf8");
const cert = readFileSync("tests/fixtures/server/certs/localhost.pem", "utf8");
const srv = tls.createServer({ key, cert }, (s) => { s.end("hi"); });
srv.listen(0, () => {
  const port = (srv.address() as any).port;
  const c = tls.connect({ host: "localhost", port, rejectUnauthorized: false });
  c.on("secureConnect", () => {
    console.log("secure", c.authorized);
    c.destroy();
    srv.close();
  });
});
