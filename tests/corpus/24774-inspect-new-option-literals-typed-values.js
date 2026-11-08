import util from "node:util";
const k = Symbol.for("nodejs.util.inspect.custom");
class Secret { constructor() { this.v = 1; } [k]() { return "<hidden>"; } }
const rec = { name: "n", list: [3, 1, 2], nested: { z: 1, a: { y: 2, b: 3 } } };
const withGet = { get g() { return { deep: 1 }; }, plain: 1 };
console.log(util.inspect(new Secret(), { customInspect: false }));
console.log(util.inspect(new Secret(), { customInspect: true }));
console.log(util.inspect({ s: new Secret() }, { customInspect: false, depth: 0 }));
console.log(util.inspect(rec, { sorted: (a, b) => (a < b ? 1 : -1) }));
console.log(util.inspect(rec, { sorted: true }));
console.log(util.inspect(withGet, { getters: true }));
console.log(util.inspect(withGet, { getters: "get" }));
console.log(util.inspect(withGet, { getters: false }));
console.log(util.inspect(withGet, {}));
const p = new Proxy({ a: 1 }, {});
const pp = JSON.parse("0") || p;
console.log(util.inspect(pp, { showProxy: true }));
console.log(util.inspect(pp, { showProxy: false }));
console.log(util.formatWithOptions({ getters: true, sorted: true }, "%O", withGet));
