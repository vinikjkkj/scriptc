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
// Where EventEmitter.call(this) runs decides where the emitter's keys sit: first, last, after a method that assigns
// fields (ioredis: parseOptions before the call), and two grafted classes in one program.
class A { constructor() { EventEmitter.call(this); this.x = 1; this.y = 2; } }
applyMixin(A, EventEmitter);
class B { constructor() { this.x = 1; this.y = 2; EventEmitter.call(this); } }
applyMixin(B, EventEmitter);
class C {
  constructor(opts) {
    this.status = "wait";
    this.parse(opts);
    EventEmitter.call(this);
    this.queue = [];
  }
  parse(opts) { this.options = opts; if (opts.verbose) this.verbose = true; this.retries = 3; }
}
applyMixin(C, EventEmitter);
class D extends C { constructor(o) { super(o); this.extra = "d"; } }
function line(v) { return forin(v) + " | " + Object.keys(v).join(",") + " | " + JSON.stringify(v); }
t("A", () => line(box(new A())));
t("B", () => line(box(new B())));
t("C verbose", () => line(box(new C({ verbose: true }))));
t("C quiet", () => line(box(new C({ verbose: false }))));
t("D", () => line(box(new D({ verbose: true }))));
t("inspect D", () => util.inspect(box(new D({ verbose: false }))));
t("inspect A", () => util.inspect(box(new A())));
