// off() over a loop-bound name removes the registration of the same function
// value, one candidate name at a time.
import { EventEmitter } from "events";

class R extends EventEmitter {}

const bus = new R();
const seen = [];
const fn = (v) => {
  seen.push(v);
};
for (const ev of ["alpha", "beta"]) bus.on(ev, fn);
bus.emit("alpha", 1);
bus.emit("beta", 2);
for (const ev of ["alpha"]) bus.off(ev, fn);
bus.emit("alpha", 3);
bus.emit("beta", 4);
console.log(seen.join(","), bus.listenerCount("alpha"), bus.listenerCount("beta"));
