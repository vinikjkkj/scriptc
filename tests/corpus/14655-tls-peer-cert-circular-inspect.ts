import * as fs from "fs";
import * as Tls from "tls";
import * as util from "util";
const dir = "tests/fixtures/tls-peer/";
const key = fs.readFileSync(dir + "self-key.pem");
const cert = fs.readFileSync(dir + "self.pem");
const srv = Tls.createServer({ key, cert }, (s) => { s.on("error", () => {}); s.end(); });
srv.listen(0, "localhost", () => {
  const port = (srv.address() as any).port;
  const sock = Tls.connect({ port, host: "localhost", ca: cert }, () => {
    const p: any = sock.getPeerCertificate(true);
    console.log(util.inspect(p).replace(/\n\s*raw:.*\n/, "\n raw: <omitted>\n"));
    try {
      const s = JSON.stringify(p);
      console.log("json", s.length);
    } catch (e: any) {
      console.log("json threw", e.name, JSON.stringify(e.message));
    }
    console.log("keys", Object.keys(p.issuerCertificate).length);
    console.log("same", p.issuerCertificate === p);
    sock.end();
    srv.close();
  });
  sock.on("error", (e: Error) => { console.log("error", e.message); srv.close(); });
});
