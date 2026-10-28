import * as fs from "fs";
import * as Tls from "tls";
const key = fs.readFileSync("tests/fixtures/server/certs/localhost-key.pem");
const cert = fs.readFileSync("tests/fixtures/server/certs/localhost.pem");
const ca = fs.readFileSync("tests/fixtures/server/certs/ca.pem");
const srv = Tls.createServer({ key, cert }, (s) => { s.on("error", () => {}); });
srv.listen(0, "127.0.0.1", () => {
  const port = (srv.address() as any).port;
  const a = Tls.connect({ port, host: "localhost", ca, checkServerIdentity: Tls.checkServerIdentity });
  a.on("secureConnect", () => { console.log("A secure"); a.end(); });
  a.on("error", (e) => { console.log("A error", e.message); a.destroy(); });
  a.on("close", () => {
    const b = Tls.connect({ port, host: "localhost", servername: "example.com", ca, checkServerIdentity: Tls.checkServerIdentity });
    b.on("secureConnect", () => { console.log("B secure"); b.end(); });
    b.on("error", (e) => { console.log("B error", e.message); b.destroy(); });
    b.on("close", () => {
      const c = Tls.connect({ port, host: "localhost", servername: "example.com", ca, checkServerIdentity: (h: string, _c: any) => undefined });
      c.on("secureConnect", () => { console.log("C secure"); c.end(); });
      c.on("error", (e) => { console.log("C error", e.message); c.destroy(); });
      c.on("close", () => {
        const d = Tls.connect({ port, host: "localhost", ca, checkServerIdentity: (h: string, _c: any) => new Error("nope " + h) });
        d.on("secureConnect", () => { console.log("D secure"); d.end(); });
        d.on("error", (e) => { console.log("D error", e.message); d.destroy(); srv.close(); });
        d.on("close", () => { srv.close(); });
      });
    });
  });
});
