// A computed-key write to a class value's `prototype` in a SLOPPY CommonJS script is ignored silently, as in Node.
function anyv(x) { return x; }
class D { m() { return 1; } }
const mk = (n = 0) => class W { m() { return n; } };
const h = {}; h.W = mk(1);
const W = anyv(h.W), DD = anyv(D);
const k = ["proto", "type"].join("");
const key = k === "prototype" ? k : "prototype";
const before = W.prototype;
W[key] = { replaced: true };
DD[key] = null;
console.log(W.prototype === before, typeof DD.prototype, new W().m());
class Strict { static poke(v, kk) { v[kk] = 1; } }
try { Strict.poke(W, key); console.log("no throw"); } catch (e) { console.log(e.name, e.message); }
