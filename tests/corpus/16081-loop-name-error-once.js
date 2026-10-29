// A loop-bound name that includes 'error' (an Error payload handled by its
// listener), plus a single-element loop registering with once().
import { EventEmitter } from "events";

class R extends EventEmitter {}

const sub = new R();
const r = new R();
const log = [];
for (const ev of ["error", "data"]) {
  sub.on(ev, (a) => {
    log.push(ev + ":" + (a instanceof Error ? a.message : a));
  });
}
for (const ev of ["data"]) {
  r.once(ev, (a, b) => log.push("once " + a + b));
}
sub.emit("data", 1);
sub.emit("error", new Error("boom"));
sub.emit("data", 2);
console.log(log.join(","), sub.listenerCount("data"), sub.listenerCount("error"));
r.emit("data", "x", "y");
r.emit("data", "z", "w");
console.log(log.join(","), r.listenerCount("data"));
