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
// Deleting and re-writing fields of a boxed grafted instance: the order record places a deleted field out of the key
// order, the emitter's keys keep their place (before or after the fields), and listeners added later move _events.
class Redis {
  constructor() {
    this.a = 1;
    this.b = 2;
    EventEmitter.call(this);
    this.c = 3;
  }
  setup() { this.d = 4; this.e = 5; }
}
applyMixin(Redis, EventEmitter);
const r = new Redis();
const v = box(r);
t("keys0", () => Object.keys(v).join(","));
r.setup();
t("keys1", () => Object.keys(box(r)).join(","));
t("delete a", () => { delete box(r).a; return Object.keys(box(r)).join(","); });
t("delete c", () => { delete box(r).c; return Object.keys(box(r)).join(",") + "|" + JSON.stringify(box(r)); });
t("forin", () => forin(box(r)));
r.on("x", () => 1);
t("json", () => JSON.stringify(box(r)));
t("inspect", () => util.inspect(box(r)));
t("values", () => JSON.stringify(Object.values(box(r)).map((x) => typeof x)));
t("count", () => box(r)._eventsCount + "," + typeof box(r)._events + "," + String(box(r)._maxListeners));
