const { EventEmitter } = require("events");
function applyMixin(d, m) { Object.getOwnPropertyNames(m.prototype).forEach((name) => { Object.defineProperty(d.prototype, name, Object.getOwnPropertyDescriptor(m.prototype, name)); }); }
class G { constructor() { EventEmitter.call(this); } }
applyMixin(G, EventEmitter);
class N extends EventEmitter {}
const e = (x) => String(x);
// a static emit with a typed tuple on the same event name
const typed = new N();
typed.on("tick", (a, b) => {});
typed.emit("tick", 1, "x");
function viaValue(x, k, name, fn) { const f = x[k]; return f.call(x, name, fn) === x; }
function viaBind(x, name, fn) { const b = x.on.bind(x); b(name, fn); return x.listenerCount(name); }
function viaKey(x, k, name, fn) { return x[k](name, fn) === x; }
function run(x) {
  process.stdout.write([viaValue(x, "on", "tick", (a, b) => process.stdout.write("tick " + a + b + "\n")), viaValue(x, "once", "z", () => {}), viaKey(x, "prependListener", "tick", (a) => process.stdout.write("first " + a + "\n")), viaBind(x, "other", () => {}), x.emit("tick", 5, "q"), x.emit("z"), x.emit("z"), x.eventNames().join(",")].map(e).join(" ") + "\n");
}
run(new G()); run(new N()); run(new EventEmitter());
