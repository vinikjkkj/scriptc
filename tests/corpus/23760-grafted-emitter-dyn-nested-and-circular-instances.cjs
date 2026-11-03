const { EventEmitter } = require("events");
const util = require("util");
function applyMixin(derivedConstructor, mixinConstructor) {
  Object.getOwnPropertyNames(mixinConstructor.prototype).forEach((name) => {
    Object.defineProperty(derivedConstructor.prototype, name, Object.getOwnPropertyDescriptor(mixinConstructor.prototype, name));
  });
}
class Base { constructor() { this.b = 1; } }
class Redis extends Base { constructor(n) { super(); this.n = n; EventEmitter.call(this); this.peer = null; } }
applyMixin(Redis, EventEmitter);
class Plain { constructor() { EventEmitter.call(this); this.k = 1; } }
applyMixin(Plain, EventEmitter);
const v = (x) => x;
function t(n, f) { try { console.log(n, f()); } catch (e) { console.log(n, "THROW", e.message); } }
const a = new Redis("a"), b = new Redis("b");
a.on("x", function handler() {});
t("nested obj", () => util.inspect({ r: v(a), list: [v(b), v(new Plain())] }, { depth: 0 }));
t("nested deep", () => util.inspect({ r: v(a), list: [v(b), v(new Plain())] }, { depth: 1 }));
t("nested log", () => util.inspect({ r: v(a), list: [v(b), v(new Plain())] }));
t("json nested", () => JSON.stringify({ r: v(b), list: [v(new Plain())] }));
a.peer = b; b.peer = a;
t("circular json", () => JSON.stringify(v(a)));
t("circular inspect", () => util.inspect(v(a)));
t("assignAll", () => Object.keys(Object.assign({}, v(a), v(new Plain()), { z: 1 })).join(","));
t("entries order", () => JSON.stringify(Object.entries(v(new Plain())).map((e) => e[0])));
t("format", () => util.format("%s %j %d", v(new Plain()), v(new Plain()), 3));
console.log("%s|%o", v(new Plain()), 1);
t("template", () => `${v(new Plain())}`);
t("string", () => String(v(a)) + String(v(new Plain())));
t("sort", () => util.inspect(v(new Plain()), { sorted: true }));
t("compact", () => util.inspect(v(new Plain()), { compact: false, breakLength: 40 }));
