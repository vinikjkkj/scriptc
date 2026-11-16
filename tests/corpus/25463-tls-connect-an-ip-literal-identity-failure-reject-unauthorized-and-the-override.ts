// tls.connect to an IP literal against a certificate that does not cover it: the 'error' event (Node's error), rejectUnauthorized:false
// (connects, authorized is false), and a user checkServerIdentity that accepts or refuses (it replaces the builtin check).
import * as fs from "fs";
import * as Tls from "tls";
const key = fs.readFileSync("tests/fixtures/server/certs/alt-key.pem");
const cert = fs.readFileSync("tests/fixtures/server/certs/alt.pem");
const ca = fs.readFileSync("tests/fixtures/server/certs/ca.pem");
const srv = Tls.createServer({ key, cert }, (s) => { s.on("error", () => {}); });
srv.listen(0, "127.0.0.1", () => {
  const port = (srv.address() as any).port;
  const a = Tls.connect({ port, host: "127.0.0.1", ca });
  a.on("secureConnect", () => { console.log("A secure (unexpected)"); a.end(); });
  a.on("error", (e) => { const x = e as any; console.log("A error", x.code, "|", e.message); a.destroy(); });
  a.on("close", () => {
    const b = Tls.connect({ port, host: "127.0.0.1", ca, rejectUnauthorized: false });
    b.on("secureConnect", () => { console.log("B secure, authorized", b.authorized); b.end(); });
    b.on("error", (e) => { console.log("B error", e.message); b.destroy(); });
    b.on("close", () => {
      const c = Tls.connect({ port, host: "127.0.0.1", ca, checkServerIdentity: (_h: string, _c: any) => undefined });
      c.on("secureConnect", () => { console.log("C secure, authorized", c.authorized); c.end(); });
      c.on("error", (e) => { console.log("C error", e.message); c.destroy(); });
      c.on("close", () => {
        const d = Tls.connect({ port, host: "127.0.0.1", ca, checkServerIdentity: (h: string, _c: any) => new Error("nope " + h) });
        d.on("secureConnect", () => { console.log("D secure"); d.end(); });
        d.on("error", (e) => { console.log("D error", e.message); d.destroy(); });
        d.on("close", () => { srv.close(); });
      });
    });
  });
});
