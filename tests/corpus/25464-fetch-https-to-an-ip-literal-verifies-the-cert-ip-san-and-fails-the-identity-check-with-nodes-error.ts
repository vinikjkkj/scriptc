// fetch() over https to an IP-LITERAL host: trusted through the process default CA list (tls.setDefaultCACertificates), the address checked
// against the certificate's IP SAN. A certificate that does not cover the address rejects the fetch with Node's `TypeError: fetch failed` (the
// ERR_TLS_CERT_ALTNAME_INVALID error rides Node's `cause`, which the static fetch cannot carry: a known divergence, not printed here). Both fetch dials share the https client config with https.get / tls.connect.
import * as fs from "fs";
import * as Https from "https";
import * as Tls from "tls";
const ca = fs.readFileSync("tests/fixtures/server/certs/ca.pem", "utf8");
Tls.setDefaultCACertificates([ca]);
const good = Https.createServer({ key: fs.readFileSync("tests/fixtures/server/certs/localhost-key.pem"), cert: fs.readFileSync("tests/fixtures/server/certs/localhost.pem") }, (_q, r) => { r.end("fetched over tls"); });
const bad = Https.createServer({ key: fs.readFileSync("tests/fixtures/server/certs/alt-key.pem"), cert: fs.readFileSync("tests/fixtures/server/certs/alt.pem") }, (_q, r) => { r.end("never"); });
function show(err: unknown): void {
  const e = err as any;
  console.log("bad", e.name, "|", e.message);
}
good.listen(0, "127.0.0.1", () => {
  bad.listen(0, "127.0.0.1", () => {
    const gp = (good.address() as any).port;
    const bp = (bad.address() as any).port;
    fetch("https://127.0.0.1:" + gp + "/").then(
      (res) => res.text().then((t) => { console.log("good", res.status, t); }),
      (err) => { console.log("good error", (err as Error).message); },
    ).then(() => fetch("https://127.0.0.1:" + bp + "/")).then(
      (res) => { console.log("bad unexpected", res.status); },
      (err) => { show(err); },
    ).then(() => { good.close(); bad.close(); });
  });
});
