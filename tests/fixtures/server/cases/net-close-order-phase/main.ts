/* The close phase comes LAST. 'close' is a close-phase callback while
 * 'data' comes out of the poll phase, so every 'data' of a turn beats
 * every 'close' of that turn -- and the two closes then run in reverse
 * destroy order:
 *
 *   a data A / b data B / b closed / a closed / srv closed
 *
 * This runtime emitted each socket's 'close' inline in its sweep walk, so
 * one socket's 'close' fired before the next socket's 'data' and the two
 * closes came out in registry order:
 *
 *   a data A / b data B / a closed / b closed / srv closed
 *
 * on every run, on both backends. Driver-less. */
import * as net from "node:net";

const srv = net.createServer((s: net.Socket) => {
  s.on("data", (d: Buffer) => { s.write(d); });
});
srv.listen(0, () => {
  const p = srv.address().port;
  const a = net.connect({ port: p }, () => {
    const b = net.connect({ port: p }, () => {
      a.on("data", (d: Buffer) => { console.log("a data " + d.toString()); a.destroy(); });
      b.on("data", (d: Buffer) => { console.log("b data " + d.toString()); b.destroy(); });
      a.on("close", () => { console.log("a closed"); });
      b.on("close", () => { console.log("b closed"); srv.close(() => console.log("srv closed")); });
      a.write("A");
      b.write("B");
    });
  });
});
