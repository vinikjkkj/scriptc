// A certificate that does not cover the address: `TypeError: fetch failed` whose cause is Node's ERR_TLS_CERT_ALTNAME_INVALID error
// (message with its reason, code, reason, host). The TypeError has no code of its own.
import * as fs from "fs";
import * as Https from "https";
import * as Tls from "tls";
Tls.setDefaultCACertificates([fs.readFileSync("tests/fixtures/server/certs/ca.pem", "utf8")]);
const bad = Https.createServer({ key: fs.readFileSync("tests/fixtures/server/certs/alt-key.pem"), cert: fs.readFileSync("tests/fixtures/server/certs/alt.pem") }, (_q, r) => { r.end("never"); });
bad.listen(0, "127.0.0.1", () => {
  const port = (bad.address() as any).port;
  fetch("https://127.0.0.1:" + port + "/").then(
    () => { console.log("unexpected response"); bad.close(); },
    (err) => {
      const e = err as any;
      console.log(e.name, "|", e.message, "| own code:", e.code);
      console.log("cause:", e.cause.name, "|", e.cause.code, "|", e.cause.message);
      console.log("reason:", e.cause.reason, "| host:", e.cause.host);
      bad.close();
    },
  );
});
