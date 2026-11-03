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
// The context-info shape: a for-in truthiness helper (hasAnyKey) applied to message objects and, through the same
// untyped parameter, to a grafted instance; plus Object.assign / spread of the instance and reads of its emitter keys.
function hasAnyKey(value) { for (const _ in value) { return true; } return false; }
class Redis { constructor() { this.status = "wait"; EventEmitter.call(this); } }
applyMixin(Redis, EventEmitter);
const r = new Redis();
r.on("data", (x) => x);
t("empty", () => hasAnyKey(box({})));
t("filled", () => hasAnyKey(box({ a: 1 })));
t("redis", () => hasAnyKey(box(r)));
t("assign", () => { const o = Object.assign({ z: 0 }, box(r)); return Object.keys(o).join(",") + "|" + typeof o._events + "|" + o._eventsCount; });
t("spread", () => { const o = { ...box(r), q: 1 }; return Object.keys(o).join(","); });
t("cells", () => typeof box(r)._events + "," + box(r)._eventsCount + "," + String(box(r)._maxListeners));
t("events keys", () => Object.keys(box(r)._events).join(","));
t("emit", () => { r.emit("data", 1); return box(r).listenerCount("data"); });
