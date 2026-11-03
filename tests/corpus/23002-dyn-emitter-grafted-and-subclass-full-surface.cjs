const { EventEmitter } = require("events");
// Printing goes through String() so no dynamic value is inspected: a grafted instance in a dynamic slot is refused
// in a program that inspects dynamic values (tests/diagnostics/grafted-emitter-dyn-reflection-refused.cjs).
const out = (...a) => { process.stdout.write(a.map((v) => String(v)).join(" ") + "\n"); };
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
  out(typeof x.emit, typeof x.on, typeof x.listenerCount, x.hello ? x.hello() : "nohello");
  x.on("ping", (a, b) => out("ping", a, b, this === undefined));
  x.once("pong", (v) => out("pong", v));
  out(x.emit("ping", 1, "two"), x.emit("pong", { k: 1 }), x.emit("pong", 2), x.emit("nolisten"));
  out(x.listenerCount("ping"), x.listenerCount("pong"), x.eventNames());
  const l = x.listeners("ping");
  out(l.length, typeof l[0]);
  out(x.getMaxListeners(), x.setMaxListeners(20) === x, x.getMaxListeners());
  const args = ["ping", 9, 8, 7];
  out(x.emit(...args));
  out(x.emit.apply(x, args));
  out(x.emit.call(x, "ping", "c", "d"));
  out(x.on("a", () => {}) === x);
  out(x.removeAllListeners("ping") === x, x.listenerCount("ping"));
  out(x.removeAllListeners() === x, x.eventNames());
  try { x.emit("error", new Error("boom")); } catch (e) { out("caught", e.message); }
  try { x.emit("error", "str"); } catch (e) { out("caught", e.code, e.message); }
  try { x.emit("error", { a: 1 }); } catch (e) { out("caught", e.code, e.message); }
  try { x.emit("error"); } catch (e) { out("caught", e.code, e.message); }
}
poke(holder.inst);
poke(holder.other);
out(holder.inst instanceof EventEmitter, holder.other instanceof EventEmitter);
function same(a, b) { return a.emit === b.emit; }
out(same(holder.inst, holder.other), same(holder.inst, holder.inst));
function has(x, k) { return k in x; }
out(has(holder.inst, "emit"), has(holder.inst, "nope"), has(holder.other, "listeners"), has(holder.other, "hello"));
