import * as fs from "fs";
import * as Tls from "tls";
const dir = "tests/fixtures/tls-peer/";
const key = fs.readFileSync(dir + "leaf-key.pem");
const chain = fs.readFileSync(dir + "chain.pem");
const ca = fs.readFileSync(dir + "ca.pem");
const srv = Tls.createServer({ key, cert: chain }, (s) => { s.on("error", () => {}); s.end(); });
// A CA-issued leaf with extended key usage and authority information access,
// and the presenting chain: issuerCertificate is the presented CA object, and
// its own issuerCertificate is the CA itself.
srv.listen(0, "localhost", () => {
  const port = (srv.address() as any).port;
  const sock = Tls.connect({ port, host: "localhost", ca, servername: "leaf.test" }, () => {
    const p: any = sock.getPeerCertificate(true);
    console.log("count", Object.keys(p).length);
    for (const k of Object.keys(p)) {
      const v: any = p[k];
      let d: string;
      if (v === undefined) d = "undefined";
      else if (Buffer.isBuffer(v)) d = "buf(" + v.length + ") " + v.toString("hex").slice(0, 16);
      else if (k === "issuerCertificate") d = v === p ? "SELF" : "OBJ " + JSON.stringify(v.subject) + " up=" + (v.issuerCertificate === v ? "SELF" : "other");
      else d = typeof v + " " + JSON.stringify(v);
      console.log(k, d);
    }
    sock.end();
    srv.close();
  });
  sock.on("error", (e: Error) => { console.log("error", e.message); srv.close(); });
});
