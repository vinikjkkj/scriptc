const { EventEmitter } = require("events");
const util = require("util");
function applyMixin(derivedConstructor, mixinConstructor) {
  Object.getOwnPropertyNames(mixinConstructor.prototype).forEach((name) => {
    Object.defineProperty(derivedConstructor.prototype, name, Object.getOwnPropertyDescriptor(mixinConstructor.prototype, name));
  });
}
function t(name, f) {
  try { console.log(name, f()); } catch (e) { console.log(name, "THROW", e && e.message); }
}
// every instance crosses an untyped parameter, so each surface below walks the boxed instance
const box = (x) => x;
function forin(v) { const out = []; for (const k in v) out.push(k); return out.join(","); }
// JSON.stringify, util.inspect, util.format and console.log of a boxed grafted instance: the emitter's keys print in
// the place the constructor ran EventEmitter.call(this), the _events table as Node's null-prototype object, then the
// two own symbol keys the emitter's init defines. The nearest ancestor with its own constructor names the object.
class Base { constructor() { this.b0 = 1; } }
class Redis extends Base {
  constructor(o) {
    super();
    this.status = "wait";
    this.opts = o;
    EventEmitter.call(this);
    this.late = 3;
  }
}
applyMixin(Redis, EventEmitter);
class Plain { constructor() { this.a = 1; EventEmitter.call(this); } }
applyMixin(Plain, EventEmitter);
class Sub extends Redis { constructor() { super(2); this.s = "sub"; } }
function show(label, v) {
  console.log("--", label);
  t("json", () => JSON.stringify(v));
  t("inspect", () => util.inspect(v));
  t("deep", () => util.inspect(v, { depth: 5 }));
  t("format", () => util.format("%j|%s", v, v));
  console.log(v);
}
const r = new Redis({ host: "h", port: 6379 });
show("fresh", box(r));
const f1 = () => 1;
function named() {}
r.on("a", f1);
r.once("b", named);
show("on and once", box(r));
r.on("a", () => 3);
r.on("c", () => 4);
show("two on a", box(r));
r.removeAllListeners("a");
show("removed a", box(r));
r.removeAllListeners();
r.setMaxListeners(7);
show("emptied", box(r));
show("plain", box(new Plain()));
const s = new Sub();
s.on("x", () => 1);
show("sub", box(s));
