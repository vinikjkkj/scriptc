// applyMixin(R, EventEmitter): the ioredis shape. Node copies EventEmitter's
// prototype onto R, so R instances are NOT instanceof EventEmitter.
import { EventEmitter } from "events";

function applyMixin(derivedConstructor, mixinConstructor) {
  Object.getOwnPropertyNames(mixinConstructor.prototype).forEach((name) => {
    Object.defineProperty(derivedConstructor.prototype, name, Object.getOwnPropertyDescriptor(mixinConstructor.prototype, name));
  });
}

class Commander {
  constructor() {
    this.tag = "base";
  }
  base() {
    return 7;
  }
}

class R extends Commander {
  constructor() {
    super();
    EventEmitter.call(this);
  }
  fire(n) {
    this.emit("ev", n, "two");
  }
  listen() {
    this.once("ev", (a, b) => console.log("once", a, b));
  }
}

applyMixin(R, EventEmitter);
const r = new R();
r.on("ev", (v, s) => console.log("got", v, s));
r.listen();
r.fire(42);
r.fire(43);
console.log(r.tag, r.base(), r instanceof EventEmitter, r.listenerCount("ev"), r.eventNames().join(","));
