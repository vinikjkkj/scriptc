import * as fs from "fs";
import * as Tls from "tls";
const key = fs.readFileSync("tests/fixtures/server/certs/localhost-key.pem");
const cert = fs.readFileSync("tests/fixtures/server/certs/localhost.pem");
const ca = fs.readFileSync("tests/fixtures/server/certs/ca.pem");
const srv = Tls.createServer({ key, cert }, (s) => { s.on("error", () => {}); s.end(); });
function connectWith(verifyIdentity: boolean, port: number, next: () => void): void {
  const sock = Tls.connect({
    host: "localhost",
    port,
    servername: "example.com",
    ca,
    rejectUnauthorized: true,
    checkServerIdentity: verifyIdentity
      ? Tls.checkServerIdentity
      : function () {
          return undefined;
        },
  });
  sock.on("error", (e) => { console.log("verify", verifyIdentity, "error", e.message); sock.destroy(); });
  sock.on("end", () => { console.log("verify", verifyIdentity, "end"); });
  sock.on("close", next);
}
srv.listen(0, "127.0.0.1", () => {
  const port = (srv.address() as any).port;
  connectWith(true, port, () => connectWith(false, port, () => srv.close()));
});
