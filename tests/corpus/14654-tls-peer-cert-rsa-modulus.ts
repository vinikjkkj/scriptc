import * as fs from "fs";
import * as Tls from "tls";
const dir = "tests/fixtures/tls-peer/";
const key = fs.readFileSync(dir + "rsa-key.pem");
const cert = fs.readFileSync(dir + "rsa.pem");
const srv = Tls.createServer({ key, cert }, (s) => { s.on("error", () => {}); s.end(); });
// getPeerCertificate(true) on a self-signed RSA leaf: Node's 20 members in
// Node's key order, the self-issued issuerCertificate as the object itself.
srv.listen(0, "localhost", () => {
  const port = (srv.address() as any).port;
  const sock = Tls.connect({ port, host: "localhost", ca: cert, servername: "rsa.test" }, () => {
    const p: any = sock.getPeerCertificate(true);
    console.log("count", Object.keys(p).length);
    for (const k of Object.keys(p)) {
      const v: any = p[k];
      let d: string;
      if (v === undefined) d = "undefined";
      else if (Buffer.isBuffer(v)) d = "buf(" + v.length + ") " + v.toString("hex").slice(0, 16);
      else if (k === "issuerCertificate") d = v === p ? "SELF" : "OBJ " + JSON.stringify(v.subject);
      else d = typeof v + " " + JSON.stringify(v);
      console.log(k, d);
    }
    sock.end();
    srv.close();
  });
  sock.on("error", (e: Error) => { console.log("error", e.message); srv.close(); });
});
