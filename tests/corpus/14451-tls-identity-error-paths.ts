import * as fs from "fs";
import * as Tls from "tls";
const key = fs.readFileSync("tests/fixtures/server/certs/localhost-key.pem");
const cert = fs.readFileSync("tests/fixtures/server/certs/localhost.pem");
const ca = fs.readFileSync("tests/fixtures/server/certs/ca.pem");
const srv = Tls.createServer({ key, cert }, (s) => { s.on("error", () => {}); });
srv.listen(0, "127.0.0.1", () => {
  const port = (srv.address() as any).port;
  const b = Tls.connect({ port, host: "localhost", servername: "example.com", ca, checkServerIdentity: Tls.checkServerIdentity });
  b.on("error", (e) => {
    const x = e as any;
    console.log("B error", e.message, e.name, x.code, x.reason, x.host, typeof x.cert, x.cert.subject.CN);
    b.destroy();
  });
  b.on("close", () => {
    const d = Tls.connect({ port, host: "localhost", ca, checkServerIdentity: (h: string, _c: any) => new Error("nope " + h) });
    d.on("error", (e) => { console.log("D error", e.message); d.destroy(); });
    d.on("close", () => { srv.close(); });
  });
});
