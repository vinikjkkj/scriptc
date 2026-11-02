const { EventEmitter } = require("events");

function applyMixin(derivedConstructor, mixinConstructor) {
  Object.getOwnPropertyNames(mixinConstructor.prototype).forEach((name) => {
    Object.defineProperty(derivedConstructor.prototype, name, Object.getOwnPropertyDescriptor(mixinConstructor.prototype, name));
  });
}

class Conn {
  constructor(label) {
    this.label = label;
    this.attempts = 0;
    EventEmitter.call(this);
  }
  kind() { return "conn:" + this.label; }
}
applyMixin(Conn, EventEmitter);

const slots = { first: { name: "s1", target: null } };
const bag = {};
const c1 = new Conn("one");
const c2 = new Conn("two");
slots.first.target = c1;
bag["c2"] = c2;
let loose = c1;
let holder = { inner: c2, first: c1 };

// handlers written over untyped receivers, as the ioredis event handlers are
const handlers = {
  hook(self, event) {
    self.on(event, (a, b) => { self.attempts = self.attempts + 1; console.log(self.label, event, a, b); });
    return () => self.label + ":" + self.kind() + ":" + self.listenerCount(event);
  },
  fire(self, event, ...args) { return self.emit(event, ...args); },
};
const h1 = handlers.hook(slots.first.target, "ready");
const h2 = handlers.hook(bag["c2"], "ready");
console.log(h1(), h2());
console.log(handlers.fire(loose, "ready", 1, "x"), handlers.fire(holder.inner, "ready", 2), handlers.fire(slots.first.target, "none"));
console.log(c1.attempts, c2.attempts);
// typed use of the same instances keeps working
c1.on("typed", (n) => console.log("typed", n));
console.log(handlers.fire(loose, "typed", 5), c1.emit("typed", 6), c1.listenerCount("typed"));
// identity survives the round trip through the untyped slots
console.log(loose === c1, holder.inner === c2, slots.first.target === c1, bag["c2"] === c2, holder.first === c1);
// once and removal through the untyped view
loose.once("go", () => console.log("go once"));
console.log(handlers.fire(loose, "go"), handlers.fire(loose, "go"));
holder.inner.removeAllListeners("ready");
console.log(c2.listenerCount("ready"), handlers.fire(holder.inner, "ready", 3));
// the instance's own members still answer through the slot
console.log(holder.first.kind(), holder.inner.kind(), holder.first.label + holder.first.attempts, holder.inner.label + holder.inner.attempts);
