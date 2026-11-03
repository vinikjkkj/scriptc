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
// A grafted class that DECLARES fields in its body: Node defines them at construction, before the constructor body, so they
// precede the emitter's keys (the call runs inside the body), and fields the body assigns afterwards follow.
class Client {
  status = "wait";
  retries = 0;
  constructor(name) {
    this.name = name;
    EventEmitter.call(this);
    this.status = "ready";
    this.tail = 1;
  }
}
applyMixin(Client, EventEmitter);
const c = new Client("c1");
t("forin", () => forin(box(c)));
t("keys", () => Object.keys(box(c)).join(","));
t("json", () => JSON.stringify(box(c)));
c.on("a", () => 1);
t("json after on", () => JSON.stringify(box(c)));
t("values", () => JSON.stringify(Object.values(box(c)).map((x) => typeof x)));
t("inspect", () => util.inspect(box(c)));
