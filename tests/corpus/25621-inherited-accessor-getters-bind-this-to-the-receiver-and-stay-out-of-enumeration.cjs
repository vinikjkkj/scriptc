// @ts-nocheck
// Accessors defined once on a prototype: this binding, inheritance, for-in and keys skipping non-enumerable ones.
function show(label, v) { console.log(label + ": " + JSON.stringify(v)); }
const proto = {};
const names = ["alpha", "beta", "gamma", "delta"];
for (const n of names) {
  Object.defineProperty(proto, "get_" + n, { get: function () { return this["_" + n] === undefined ? "none:" + n : this["_" + n]; }, configurable: true });
}
Object.defineProperty(proto, "visible", { get: function () { return "v:" + (this.id ?? "?"); }, enumerable: false, configurable: true });
const a = Object.create(proto); a.id = 1; a._alpha = "A";
const b = Object.create(proto); b.id = 2; b._beta = "B";
show("a", [a.get_alpha, a.get_beta, a.visible]);
show("b", [b.get_alpha, b.get_beta, b.visible]);
const c = Object.create(a); c.id = 3;
show("chain", [c.get_alpha, c.visible]);
const forin = [];
for (const k in a) forin.push(k);
show("for-in", forin);
show("keys", Object.keys(a));
show("keys-proto", Object.keys(proto));
show("has", ["get_alpha" in a, a.hasOwnProperty("get_alpha"), Object.prototype.hasOwnProperty.call(proto, "get_alpha")]);
show("json", JSON.stringify(a));
show("assign", Object.keys(Object.assign({}, a)));
show("entries", Object.entries(a));
show("getter-this-free", (() => { const f = Object.getOwnPropertyDescriptor(proto, "get_alpha").get; return f.call({ _alpha: "free" }); })());
