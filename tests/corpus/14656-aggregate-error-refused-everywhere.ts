import * as fs from "fs";
import * as Tls from "tls";
// A connect that every address refuses. Whether `localhost` is one address
// (127.0.0.1 only, as on a runner without IPv6) or two (::1 then 127.0.0.1)
// decides whether Node's error is an AggregateError or a plain Error, so this
// program prints only facts that hold for BOTH answers: the code, the
// Error-ness, the message shape (empty for the aggregate, "connect ECONNREFUSED
// ip:port" for the plain one), and every attempt's code, errno, syscall and
// Error identity. Ports are normalized (they differ between runs).
const cert = fs.readFileSync("tests/fixtures/tls-peer/self.pem");
const probe = Tls.createServer({ key: fs.readFileSync("tests/fixtures/tls-peer/self-key.pem"), cert }, () => {});
probe.listen(0, "localhost", () => {
  const port = (probe.address() as any).port;
  const norm = (v: unknown) => String(v).split(String(port)).join("PORT");
  probe.close(() => {
    const sock = Tls.connect({ port, host: "localhost", ca: cert }, () => console.log("unexpected secure"));
    // every attempt (the aggregate's members, or the error itself) satisfies pred
    const all = (err: any, pred: (x: any) => boolean): boolean => {
      if (err.errors === undefined) return pred(err);
      for (let i = 0; i < err.errors.length; i++) {
        if (!pred(err.errors[i])) return false;
      }
      return true;
    };
    sock.on("error", (e: unknown) => {
      const err: any = e;
      console.log("code", err.code);
      console.log("instanceof Error", e instanceof Error);
      console.log("message is aggregate or plain", err.message === "" || norm(err.message) === "connect ECONNREFUSED 127.0.0.1:PORT" || norm(err.message).startsWith("connect ECONNREFUSED "));
      console.log("attempts all Error", all(err, (x: any) => x instanceof Error));
      console.log("attempts all ECONNREFUSED", all(err, (x: any) => x.code === "ECONNREFUSED"));
      console.log("attempts all errno -111", all(err, (x: any) => x.errno === -111));
      console.log("attempts all syscall connect", all(err, (x: any) => x.syscall === "connect"));
      console.log("attempts all on this port", all(err, (x: any) => x.port === port));
    });
  });
});
