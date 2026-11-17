// A fetch() to a port nothing listens on rejects with Node's `TypeError: fetch failed` whose own non-enumerable `cause` is the connect error
// (code, errno, syscall, address, port). The TypeError itself has no code. (The port is bound and released first, so it is closed.)
import * as Net from "net";
const probe = Net.createServer();
probe.listen(0, "127.0.0.1", () => {
  const port = (probe.address() as any).port;
  probe.close(() => {
    fetch("http://127.0.0.1:" + port + "/").then(
      () => { console.log("unexpected response"); },
      (err) => {
        const e = err as any;
        console.log(e.name, "|", e.message, "| own code:", e.code);
        console.log("cause:", e.cause.name, "|", e.cause.message.replace(String(port), "PORT"));
        console.log("cause code/syscall/address:", e.cause.code, e.cause.syscall, e.cause.address, e.cause.port === port);
        console.log(Object.prototype.hasOwnProperty.call(e, "cause"), Object.keys(e).join(","));
      },
    );
  });
});
