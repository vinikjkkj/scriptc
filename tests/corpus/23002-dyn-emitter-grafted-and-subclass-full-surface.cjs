const { EventEmitter } = require("events");
function applyMixin(derivedConstructor, mixinConstructor) {
  Object.getOwnPropertyNames(mixinConstructor.prototype).forEach((name) => {
    Object.defineProperty(derivedConstructor.prototype, name, Object.getOwnPropertyDescriptor(mixinConstructor.prototype, name));
  });
}
class Redis {
  constructor(name) { this.name = name; EventEmitter.call(this); }
  hello() { return "hi " + this.name; }
}
applyMixin(Redis, EventEmitter);
class Sub extends EventEmitter { constructor() { super(); this.tag = "sub"; } }

const holder = { inst: new Redis("r1"), other: new Sub() };
function poke(x) {
  console.log(typeof x.emit, typeof x.on, typeof x.listenerCount, x.hello ? x.hello() : "nohello");
  x.on("ping", (a, b) => console.log("ping", a, b, this === undefined));
  x.once("pong", (v) => console.log("pong", v));
  console.log(x.emit("ping", 1, "two"), x.emit("pong", { k: 1 }), x.emit("pong", 2), x.emit("nolisten"));
  console.log(x.listenerCount("ping"), x.listenerCount("pong"), x.eventNames());
  const l = x.listeners("ping");
  console.log(l.length, typeof l[0]);
  console.log(x.getMaxListeners(), x.setMaxListeners(20) === x, x.getMaxListeners());
  const args = ["ping", 9, 8, 7];
  console.log(x.emit(...args));
  console.log(x.emit.apply(x, args));
  console.log(x.emit.call(x, "ping", "c", "d"));
  console.log(x.on("a", () => {}) === x);
  console.log(x.removeAllListeners("ping") === x, x.listenerCount("ping"));
  console.log(x.removeAllListeners() === x, x.eventNames());
  try { x.emit("error", new Error("boom")); } catch (e) { console.log("caught", e.message); }
  try { x.emit("error", "str"); } catch (e) { console.log("caught", e.code, e.message); }
  try { x.emit("error", { a: 1 }); } catch (e) { console.log("caught", e.code, e.message); }
  try { x.emit("error"); } catch (e) { console.log("caught", e.code, e.message); }
}
poke(holder.inst);
poke(holder.other);
console.log(holder.inst instanceof EventEmitter, holder.other instanceof EventEmitter);
function same(a, b) { return a.emit === b.emit; }
console.log(same(holder.inst, holder.other), same(holder.inst, holder.inst));
function has(x, k) { return k in x; }
console.log(has(holder.inst, "emit"), has(holder.inst, "nope"), has(holder.other, "listeners"), has(holder.other, "hello"));
