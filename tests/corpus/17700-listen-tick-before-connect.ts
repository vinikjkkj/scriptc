// Node drains the tick queue and then the promise jobs after EACH callback of a poll batch:
// a tick queued by the listen callback runs before the connect event delivered in the same batch.
import * as net from "net";
const srv = net.createServer(() => {});
srv.listen(0, "127.0.0.1", () => {
  console.log("listening");
  process.nextTick(() => console.log("tick-listen"));
  Promise.resolve().then(() => console.log("micro-listen"));
  const c = net.createConnection({ port: srv.address().port, host: "127.0.0.1" });
  c.on("connect", () => {
    console.log("connect");
    process.nextTick(() => console.log("tick-connect"));
    Promise.resolve().then(() => console.log("micro-connect"));
    c.destroy(); srv.close();
  });
});
