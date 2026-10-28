import * as fs from "fs";
import * as Tls from "tls";
const key = fs.readFileSync("tests/fixtures/server/certs/localhost-key.pem");
const cert = fs.readFileSync("tests/fixtures/server/certs/localhost.pem");
const ca = fs.readFileSync("tests/fixtures/server/certs/ca.pem");
const srv = Tls.createServer({ key, cert }, (s) => {
  s.on("error", () => {});
  s.on("data", (d: Buffer) => s.write("pong:" + d.toString()));
});
// No session, an explicit undefined, a Buffer that is not a session, and an
// empty Buffer: none resumes, every connection answers getSession(), and the
// 'session' event (registered on each socket) never fires — Node's measured
// behaviour on a client TLSSocket.
function run(port: number, label: string, session: Buffer | undefined, next: () => void) {
  let events = 0;
  const sock = Tls.connect({ port, host: "localhost", ca, session }, () => {
    console.log(label, "reused", sock.isSessionReused());
    sock.write("x");
  });
  sock.on("session", () => { events++; });
  sock.on("data", (d: Buffer) => {
    console.log(label, "data", d.toString());
    const g = sock.getSession();
    console.log(label, "getSession", g === undefined ? "undefined" : (g.length > 0 ? "bytes" : "empty"));
    console.log(label, "session events", events);
    sock.end();
  });
  sock.on("error", (e: Error) => { console.log(label, "error", e.message); next(); });
  sock.on("close", () => next());
}
srv.listen(0, "127.0.0.1", () => {
  const port = (srv.address() as any).port;
  run(port, "A-none", undefined, () => {
    run(port, "B-undef", undefined, () => {
      run(port, "C-garbage", Buffer.from("garbage"), () => {
        run(port, "D-empty", Buffer.alloc(0), () => {
          srv.close();
          console.log("done");
        });
      });
    });
  });
});
