/* FIVE servers closing in one turn -- three busy, two already drained --
 * and three client sockets destroyed out of order in the same turn.
 *
 * It pins two orders at once. The servers emit in the order they became
 * DUE: the two drained ones at their own close() call, then the busy ones
 * as their held connections die. The sockets emit after every one of them,
 * and among themselves the socket whose callback is on the stack goes
 * first while the rest run in reverse destroy order:
 *
 *   idle1 / idle2 / srv0 / srv1 / srv2 / client2 / client1 / client0
 *
 * Before the close phase existed this runtime printed the two queues
 * zipped together -- idle1, idle2, client0, srv0, client1, srv1, client2,
 * srv2 -- on every run, on both backends. Driver-less. */
import * as net from "node:net";

let h0: net.Socket | null = null;
let h1: net.Socket | null = null;
let h2: net.Socket | null = null;
const s0 = net.createServer((s: net.Socket) => { h0 = s; });
const s1 = net.createServer((s: net.Socket) => { h1 = s; });
const s2 = net.createServer((s: net.Socket) => { h2 = s; });
const idle1 = net.createServer(() => {});
const idle2 = net.createServer(() => {});

s0.listen(0, () => {
  s1.listen(0, () => {
    s2.listen(0, () => {
      idle1.listen(0, () => {
        idle2.listen(0, () => {
          const c0 = net.connect({ port: s0.address().port }, () => {
            const c1 = net.connect({ port: s1.address().port }, () => {
              const c2 = net.connect({ port: s2.address().port }, () => {
                c0.on("close", () => console.log("client0 closed"));
                c1.on("close", () => console.log("client1 closed"));
                c2.on("close", () => console.log("client2 closed"));
                idle1.close(() => console.log("idle1 closed"));
                s0.close(() => console.log("srv0 closed"));
                s1.close(() => console.log("srv1 closed"));
                idle2.close(() => console.log("idle2 closed"));
                s2.close(() => console.log("srv2 closed"));
                c2.destroy();
                c0.destroy();
                c1.destroy();
                if (h0 !== null) h0.destroy();
                if (h1 !== null) h1.destroy();
                if (h2 !== null) h2.destroy();
              });
            });
          });
        });
      });
    });
  });
});
