// The tls server with a TYPED-RECORD options binding and a one-parameter
// connection handler: `const opts: TlsOpts = {...}` is not an object literal,
// so the lowering boxes the record into the runtime walk and emits
// tls.createServerDynCb. The handler's arity picks the socket adapter, and a
// real TLS client handshake drives it, so the adapter runs end to end. The
// client skips certificate verification (the fixture is self-signed).
import { readFileSync } from "node:fs";
import * as tls from "node:tls";

type TlsOpts = { key: string; cert: string };
const opts: TlsOpts = {
  key: readFileSync("tests/fixtures/server/certs/localhost-key.pem", "utf8"),
  cert: readFileSync("tests/fixtures/server/certs/localhost.pem", "utf8"),
};

const srv = tls.createServer(opts, (sock) => {
  console.log("server saw socket", sock.remoteAddress !== undefined);
  sock.end("one");
});
srv.listen(0, () => {
  const port = srv.address()!.port;
  console.log("listening", port > 0);
  const c = tls.connect({ host: "localhost", port: port, rejectUnauthorized: false }, () => {
    console.log("client authorized", c.authorized);
  });
  c.setEncoding("utf8");
  let body = "";
  c.on("data", (chunk: Buffer) => { body += chunk.toString(); });
  c.on("end", () => {
    console.log("body", body);
    srv.close();
  });
});
