// A 'session' listener on the TLS client socket (the tls.sockOnSession row):
// the client receives the TLS session ticket, reported as a non-empty buffer.
import { readFileSync } from "node:fs";
import * as tls from "node:tls";

const key = readFileSync("tests/fixtures/server/certs/localhost-key.pem", "utf8");
const cert = readFileSync("tests/fixtures/server/certs/localhost.pem", "utf8");
const srv = tls.createServer({ key, cert }, (s) => { s.end("hi"); });
srv.listen(0, () => {
  const port = (srv.address() as any).port;
  const c = tls.connect({ host: "localhost", port, rejectUnauthorized: false });
  c.on("data", () => {});
  c.on("close", () => { srv.close(); });
  c.on("error", () => {});
  c.on("session", (buf: Buffer) => { console.log("session", buf.length > 0); });
  c.on("secureConnect", () => { c.end(); });
});
