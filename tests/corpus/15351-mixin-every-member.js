// Every EventEmitter member a mixin instance can call with a literal event
// name, in one program: listener order, once, prepend, off, removal, counts.
// (listeners()/rawListeners() on a JS listener are refused for every emitter
// subclass, and are not in this row.)
import { EventEmitter } from "events";

function applyMixin(derivedConstructor, mixinConstructor) {
  Object.getOwnPropertyNames(mixinConstructor.prototype).forEach((name) => {
    Object.defineProperty(derivedConstructor.prototype, name, Object.getOwnPropertyDescriptor(mixinConstructor.prototype, name));
  });
}

class Base {
  constructor() {
    this.tag = "base";
  }
}

class R extends Base {
  constructor() {
    super();
    EventEmitter.call(this);
  }
  fire(n) {
    this.emit("ev", n);
    return this.emit("nolisten", 1);
  }
  arm() {
    this.once("ev", (a) => console.log("inner once", a));
    this.prependListener("ev", (a) => console.log("prepended", a));
    this.prependOnceListener("ev", (a) => console.log("prepended once", a));
  }
  count() {
    return this.listenerCount("ev");
  }
}

applyMixin(R, EventEmitter);
const r = new R();
const h1 = (a) => console.log("h1", a);
const h2 = (a) => console.log("h2", a);
r.on("ev", h1);
r.addListener("ev", h2);
r.arm();
console.log("count", r.count(), r.listenerCount("ev"), r.getMaxListeners());
r.setMaxListeners(5);
console.log("max", r.getMaxListeners());
r.fire(1);
r.fire(2);
r.off("ev", h1);
r.removeListener("ev", h2);
console.log("after remove", r.listenerCount("ev"), r.eventNames().join(","));
r.on("x", (a) => console.log("x1", a));
console.log("raw", r.listenerCount("x"));
r.removeAllListeners("x");
console.log("after removeAll", r.listenerCount("x"), r.eventNames().join(","));
r.on("err", () => {});
r.emit("err", 5);
console.log("end", r.tag);
r.emit("err2", 1);
