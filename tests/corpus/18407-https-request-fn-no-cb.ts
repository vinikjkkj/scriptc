// The requestFn binding (`const requestFn = tls ? https.request : http.request`)
// called with ONE argument (the https.requestFn row): the TLS flag is a
// defaulted parameter, so the ternary binds the client at each call. The
// request is sent and the server's 'request' listener reports it.
import { readFileSync } from "node:fs";
import * as http from "node:http";
import * as https from "node:https";

const key = readFileSync("tests/fixtures/server/certs/localhost-key.pem", "utf8");
const cert = readFileSync("tests/fixtures/server/certs/localhost.pem", "utf8");

function fire(port: number, tls = false): void {
  const requestFn = tls ? https.request : http.request;
  const req = requestFn({ hostname: "127.0.0.1", port, path: "/", method: "GET", ...(tls ? { rejectUnauthorized: false } : {}) });
  req.on("error", () => {});
  req.end();
}

const srv = https.createServer({ key, cert }, (req, res) => {
  console.log("served", req.method, req.url);
  res.end("discarded");
  srv.close();
});
srv.listen(0, "127.0.0.1", () => {
  fire((srv.address() as any).port, true);
});
