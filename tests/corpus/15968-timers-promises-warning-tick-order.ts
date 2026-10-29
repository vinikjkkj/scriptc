// A delay warning from node:timers/promises is deferred by process.nextTick,
// like Node's emitWarning: it is queued AT the call, so it runs in call order
// with the nextTicks queued around it, after the synchronous code that made the
// call. The 'warning' listener and the logs below must interleave exactly so.
import { setTimeout as sleep } from "node:timers/promises";

process.on("warning", (w: Error) => {
  console.log("listener", w.name);
});

console.log("sync1");
process.nextTick(() => console.log("tick A"));
const p = sleep(NaN, "nan");
console.log("sync2");
process.nextTick(() => console.log("tick B"));
p.then((v) => console.log("value", v));
console.log("sync3");
