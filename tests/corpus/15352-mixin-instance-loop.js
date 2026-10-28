// 200 mixin instances, each with a once listener and a removed listener: the
// grafted emitter slot is created and released with its instance.
import { EventEmitter } from "events";

function applyMixin(derivedConstructor, mixinConstructor) {
  Object.getOwnPropertyNames(mixinConstructor.prototype).forEach((name) => {
    Object.defineProperty(derivedConstructor.prototype, name, Object.getOwnPropertyDescriptor(mixinConstructor.prototype, name));
  });
}

class R {
  constructor(tag) {
    EventEmitter.call(this);
    this.tag = tag;
  }
  go(n) {
    this.once("ev", (a) => {
      if (a === n) this.emit("done", a);
    });
    this.emit("ev", n);
  }
}

applyMixin(R, EventEmitter);
let total = 0;
for (let i = 0; i < 200; i++) {
  const r = new R("t" + i);
  r.on("done", (a) => {
    total += a;
  });
  r.go(i);
  r.removeAllListeners("done");
}
console.log("total", total);
