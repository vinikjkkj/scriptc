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
// A class grafted by applyMixin(Y, EventEmitter) whose constructor assigns fields before and after EventEmitter.call(this):
// its own keys list the emitter's _events, _eventsCount, _maxListeners where the call ran, then for-in appends the
// grafted prototype's enumerable members. Every key-listing surface over the boxed instance, in each emitter state.
class Base { constructor() { this.b0 = 1; } }
class Redis extends Base {
  constructor(o) {
    super();
    this.status = "wait";
    this.opts = o;
    EventEmitter.call(this);
    this.late = 3;
  }
  ping() { return "pong"; }
}
applyMixin(Redis, EventEmitter);
function surfaces(label, v) {
  console.log("--", label);
  t("forin", () => forin(v));
  t("keys", () => Object.keys(v).join(","));
  t("values", () => Object.values(v).map((x) => typeof x).join(","));
  t("entries", () => Object.entries(v).map((e) => e[0] + ":" + typeof e[1]).join(","));
  t("hasOwn", () => ["_events", "_eventsCount", "_maxListeners", "b0", "status", "late", "on", "ping", "zzz"].map((k) => Object.hasOwn(v, k)).join(","));
  t("hasOwnProperty", () => ["_events", "status", "on", "ping"].map((k) => v.hasOwnProperty(k)).join(","));
  t("in", () => ["_events", "on", "ping", "late", "zzz"].map((k) => k in v).join(","));
  t("getOwnPropertyNames", () => Object.getOwnPropertyNames(v).join(","));
}
const r = new Redis(5);
surfaces("fresh", box(r));
r.on("a", () => 1);
r.once("b", () => 2);
surfaces("after on and once", box(r));
r.on("a", () => 3);
surfaces("two listeners on a", box(r));
r.removeAllListeners();
surfaces("after removeAllListeners", box(r));
r.setMaxListeners(7);
surfaces("after setMaxListeners", box(r));
