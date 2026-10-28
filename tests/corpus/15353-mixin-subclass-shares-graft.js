// A subclass of a mixin class is a mixin instance too: its emits reach the
// listeners of the base's events, and its own listeners see the base's emits.
import { EventEmitter } from "events";

function applyMixin(derivedConstructor, mixinConstructor) {
  Object.getOwnPropertyNames(mixinConstructor.prototype).forEach((name) => {
    Object.defineProperty(derivedConstructor.prototype, name, Object.getOwnPropertyDescriptor(mixinConstructor.prototype, name));
  });
}

class Root {
  constructor() {
    EventEmitter.call(this);
  }
  ping(n) {
    this.emit("ping", n);
  }
}

class Child extends Root {
  constructor() {
    super();
    this.kind = "child";
  }
  pong(n) {
    this.emit("pong", n, this.kind);
  }
}

applyMixin(Root, EventEmitter);
const c = new Child();
c.on("ping", (n) => console.log("child got ping", n));
c.on("pong", (n, k) => console.log("child got pong", n, k));
c.ping(1);
c.pong(2);
console.log(c.listenerCount("ping"), c.listenerCount("pong"), c.kind);
