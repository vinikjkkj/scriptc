const { EventEmitter } = require("events");
// Printing goes through String() so no dynamic value is inspected: a grafted instance in a dynamic slot is refused
// in a program that inspects dynamic values (tests/diagnostics/grafted-emitter-dyn-reflection-refused.cjs).
const out = (...a) => { process.stdout.write(a.map((v) => String(v)).join(" ") + "\n"); };
function applyMixin(d, m) { Object.getOwnPropertyNames(m.prototype).forEach((name) => { Object.defineProperty(d.prototype, name, Object.getOwnPropertyDescriptor(m.prototype, name)); }); }
class Redis { constructor(n) { this.n = n; this.last = -1; EventEmitter.call(this); } }
applyMixin(Redis, EventEmitter);
class Sub extends EventEmitter { constructor(n) { super(); this.n = n; this.last = -1; } }
const handlers = {
  attach(self) {
    self.on("data", (v) => { self.last = v; });
    self.once("close", () => { self.emit("closed", self.n); });
    self.on("closed", (n) => out("closed", n));
  },
};
for (let i = 0; i < 3; i++) {
  const a = new Redis("r" + i);
  const b = new Sub("s" + i);
  handlers.attach(a);
  handlers.attach(b);
  a.emit("data", i);
  b.emit("data", i * 2);
  a.emit("close");
  b.emit("close");
  out(a.last, b.last, a.listenerCount("data"), b.listenerCount("closed"));
}
// cycle that is abandoned with listeners still attached
function leaky(n) {
  const r = new Redis("leak" + n);
  handlers.attach(r);
  const s = new Sub("leaks" + n);
  handlers.attach(s);
  r.on("x", () => r.listenerCount("x") + s.listenerCount("x"));
  s.on("x", () => s.listenerCount("x") + r.listenerCount("x"));
}
for (let i = 0; i < 4; i++) leaky(i);
out("done");
