import * as fs from "fs";
import * as Tls from "tls";
const key = fs.readFileSync("tests/fixtures/server/certs/localhost-key.pem");
const cert = fs.readFileSync("tests/fixtures/server/certs/localhost.pem");
const ca = fs.readFileSync("tests/fixtures/server/certs/ca.pem");
const srv = Tls.createServer({ key, cert }, (s) => { s.on("error", () => {}); });
// Node's tls.connect hands `session` to setSession, which throws
// ERR_INVALID_ARG_TYPE for anything that is not a buffer. null and undefined
// mean "no session" and connect.
srv.listen(0, "127.0.0.1", () => {
  const port = (srv.address() as any).port;
  const values: unknown[] = ["abc", 5, {}];
  for (const v of values) {
    try {
      const sock = Tls.connect({ port, host: "localhost", ca, session: v as any });
      console.log("no throw", typeof v);
      sock.on("error", () => {});
      sock.destroy();
    } catch (e: any) {
      console.log("threw", e.code, e.message);
    }
  }
  const ok = Tls.connect({ port, host: "localhost", ca, session: null as any }, () => {
    console.log("null ok", ok.isSessionReused());
    ok.destroy();
    srv.close();
  });
  ok.on("error", () => {});
});
