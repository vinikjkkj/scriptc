import * as fs from "fs";
import * as Tls from "tls";
// A connect that every address refuses: Node's autoSelectFamily chain ends in
// an AggregateError. Its `errors` are real Error objects (errno, code, syscall,
// address, port as own members), `instanceof AggregateError` and `instanceof
// Error` hold, and the ports are normalized (they differ between runs).
const cert = fs.readFileSync("tests/fixtures/tls-peer/self.pem");
const probe = Tls.createServer({ key: fs.readFileSync("tests/fixtures/tls-peer/self-key.pem"), cert }, () => {});
probe.listen(0, "localhost", () => {
  const port = (probe.address() as any).port;
  probe.close(() => {
    const sock = Tls.connect({ port, host: "localhost", ca: cert }, () => console.log("unexpected secure"));
    sock.on("error", (e: unknown) => {
      const err: any = e;
      const p = (v: unknown) => String(v).split(String(port)).join("PORT");
      console.log("name", err.name, "code", err.code, "message", JSON.stringify(err.message));
      console.log("instanceof AggregateError", e instanceof AggregateError, "instanceof Error", e instanceof Error);
      console.log("errors", err.errors.length);
      for (const x of err.errors) {
        console.log("  inner", x instanceof Error, x.name, x.code, x.errno, x.syscall, x.address, p(x.port), p(x.message));
      }
      console.log("keys", JSON.stringify(Object.keys(err)));
    });
  });
});
