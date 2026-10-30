// The https server with a TYPED-RECORD options binding and a two-parameter
// request handler: `const opts: TlsOpts = {...}` is not an object literal, so
// the lowering boxes the record into the runtime walk and emits
// https.createServerDynCb. The request adapter is chosen by the handler's
// arity (two here), and the request is served over a real TLS handshake, so
// the adapter is exercised end to end and not only constructed. The client
// skips certificate verification (the fixture is self-signed); the server
// listens on an ephemeral port and closes after the response.
import { readFileSync } from "node:fs";
import * as https from "node:https";

type TlsOpts = { key: string; cert: string };
const opts: TlsOpts = {
  key: readFileSync("tests/fixtures/server/certs/localhost-key.pem", "utf8"),
  cert: readFileSync("tests/fixtures/server/certs/localhost.pem", "utf8"),
};

const srv = https.createServer(opts, (req, res) => {
  res.end("two " + req.method);
});
srv.listen(0, () => {
  const port = srv.address()!.port;
  console.log("listening", port > 0);
  const r = https.request({ host: "localhost", port: port, path: "/", method: "GET", rejectUnauthorized: false }, (res) => {
    res.setEncoding("utf8");
    let body = "";
    res.on("data", (c: Buffer) => { body += c.toString(); });
    res.on("end", () => {
      console.log("body", body);
      srv.close();
    });
  });
  r.end();
});
