// TLSSocket.isSessionReused() on a full handshake: false under Node, and the
// runtime never resumes a session, so it is false here too. Typed through this
// directory's tsconfig (@types/node declares isSessionReused).
import * as fs from "fs";
import * as tls from "tls";
const key = fs.readFileSync("tests/fixtures/server/certs/localhost-key.pem");
const cert = fs.readFileSync("tests/fixtures/server/certs/localhost.pem");
const ca = fs.readFileSync("tests/fixtures/server/certs/ca.pem");
const srv = tls.createServer({ key, cert }, (sock) => { sock.on("error", () => {}); sock.end(); });
srv.listen(0, "127.0.0.1", () => {
  const port = (srv.address() as any).port;
  const client = tls.connect({ host: "localhost", port, ca });
  client.on("secureConnect", () => {
    console.log("reused", client.isSessionReused());
    client.end();
  });
  client.on("error", (e) => { console.log("error", e.message); });
  client.on("close", () => srv.close());
});
