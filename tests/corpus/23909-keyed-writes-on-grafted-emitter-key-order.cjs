const { EventEmitter } = require("events");
function applyMixin(derivedConstructor, mixinConstructor) {
  Object.getOwnPropertyNames(mixinConstructor.prototype).forEach((name) => {
    Object.defineProperty(derivedConstructor.prototype, name, Object.getOwnPropertyDescriptor(mixinConstructor.prototype, name));
  });
}
function t(name, f) {
  try { console.log(name, f()); } catch (e) { console.log(name, "THROW", e && e.message); }
}
// An emitter-grafted class (ioredis Redis) whose constructor writes keys under run-time keys between its field assignments and
// around EventEmitter.call(this): every enumerating surface over the boxed instance lists the keys in creation order.
class Redis {
  constructor() {
    this.status = "wait";
    this.put("one", 1);
    EventEmitter.call(this);
    this.opts = { a: 1 };
    this.put("two", [2]);
    this.late = 3;
  }
  put(k, v) {
    this[k] = v;
  }
}
applyMixin(Redis, EventEmitter);
const box = (x) => x;
function surfaces(label, v) {
  console.log("--", label);
  t("keys", () => Object.keys(v).join(","));
  t("values", () => Object.values(v).map((x) => typeof x).join(","));
  t("entries", () => Object.entries(v).map((e) => e[0]).join(","));
  t("json", () => JSON.stringify(v));
  t("spread", () => Object.keys({ ...v }).join(","));
  t("assign", () => Object.keys(Object.assign({}, v)).join(","));
  t("names", () => Object.getOwnPropertyNames(v).join(","));
  const seen = [];
  for (const k in v) seen.push(k);
  t("forin", () => seen.join(","));
  console.log(v);
}
const r = new Redis();
surfaces("after ctor", box(r));
r.put("three", 3);
r.put("1", "one");
r.later = "L";
surfaces("after more writes", box(r));
