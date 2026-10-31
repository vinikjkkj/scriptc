// The same typed-record tls server with a ZERO-parameter connection handler:
// the adapter is the no-argument thunk (scr_net_conn_thunk0), the other arm of
// the handler-arity choice. The handler runs once per accepted TLS connection.
import { readFileSync } from "node:fs";
import * as tls from "node:tls";

type TlsOpts = { key: string; cert: string };
const opts: TlsOpts = {
  key: readFileSync("tests/fixtures/server/certs/localhost-key.pem", "utf8"),
  cert: readFileSync("tests/fixtures/server/certs/localhost.pem", "utf8"),
};

let served = 0;
const srv = tls.createServer(opts, () => {
  served++;
  console.log("served", served);
});
srv.listen(0, () => {
  const port = srv.address()!.port;
  const c = tls.connect({ host: "localhost", port: port, rejectUnauthorized: false }, () => {
    console.log("client connected", c.authorized);
    c.end();
    srv.close();
  });
  c.on("error", () => {});
});
