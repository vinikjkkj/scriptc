// The requestFn binding called WITH a response callback (the https.requestFnCb
// row): the TLS flag picks https.request, the response body arrives through
// the callback, and the same binding would pick http.request for false.
import { readFileSync } from "node:fs";
import * as http from "node:http";
import * as https from "node:https";

const key = readFileSync("tests/fixtures/server/certs/localhost-key.pem", "utf8");
const cert = readFileSync("tests/fixtures/server/certs/localhost.pem", "utf8");

function ping(port: number, tls = false): void {
  const requestFn = tls ? https.request : http.request;
  const req = requestFn(
    { hostname: "127.0.0.1", port, path: "/", method: "GET", ...(tls ? { rejectUnauthorized: false } : {}) },
    (res) => {
      let body = "";
      res.on("data", (c: Buffer) => { body += c.toString(); });
      res.on("end", () => { console.log("body", body); srv.close(); });
    }
  );
  req.on("error", (e: Error) => { console.log("error", e.message); srv.close(); });
  req.end();
}

const srv = https.createServer({ key, cert }, (req, res) => { res.end("cb " + req.method); });
srv.listen(0, "127.0.0.1", () => {
  ping((srv.address() as any).port, true);
});
