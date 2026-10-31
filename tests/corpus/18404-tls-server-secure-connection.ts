// The TLS server's 'secureConnection' listener (net.serverOnSecureConnection):
// it fires once the handshake completes, with the decrypted socket.
import { readFileSync } from "node:fs";
import * as tls from "node:tls";

const key = readFileSync("tests/fixtures/server/certs/localhost-key.pem", "utf8");
const cert = readFileSync("tests/fixtures/server/certs/localhost.pem", "utf8");
const srv = tls.createServer({ key, cert });
srv.on("secureConnection", (s) => {
  console.log("server secureConnection");
  s.end("hi");
  srv.close();
});
srv.listen(0, () => {
  const port = (srv.address() as any).port;
  const c = tls.connect({ host: "localhost", port, rejectUnauthorized: false });
  c.setEncoding("utf8");
  c.on("data", (d: Buffer) => { console.log("client got", d.toString()); });
  c.on("error", () => {});
});
