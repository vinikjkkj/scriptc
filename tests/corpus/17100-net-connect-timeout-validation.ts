// createConnection({ timeout }) validates a truthy delay before the dial (Node's
// net.connect: `if (options.timeout)`): -1 and Infinity throw ERR_OUT_OF_RANGE;
// 0 and NaN are falsy and arm nothing. Each case runs after the previous closes.
import * as net from "net";
let accepted = 0;
const srv = net.createServer((s) => { accepted++; s.on("error", () => {}); });
const cases: [string, number][] = [["neg", -1], ["inf", Infinity], ["zero", 0], ["nan", NaN]];
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  let i = 0;
  const next = (): void => {
    if (i === cases.length) {
      setTimeout(() => { console.log("accepted", accepted); srv.close(); }, 100);
      return;
    }
    const [label, t] = cases[i++]!;
    try {
      const c = net.createConnection({ port, host: "127.0.0.1", timeout: t });
      c.on("error", (e: any) => { console.log(label, "error", e.code); });
      c.on("connect", () => { console.log(label, "connected"); c.destroy(); });
      c.on("close", () => next());
    } catch (e: any) {
      console.log(label, "THROW", e.name, e.code, JSON.stringify(e.message));
      next();
    }
  };
  next();
});
