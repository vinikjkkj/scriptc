// The same write in an ES module (strict): TypeError with V8's text, which names the class source.
function anyv(x) { return x; }
class D { m() { return 1; } }
const mk = (n = 0) => class W { m() { return n; } };
const h = {}; h.W = mk(1);
const W = anyv(h.W), DD = anyv(D);
const k = ["proto", "type"].join("");
const key = k === "prototype" ? k : "prototype";
for (const C of [W, DD]) {
  try { C[key] = { replaced: true }; console.log("no throw"); } catch (e) { console.log(e.name + ": " + e.message); }
}
console.log(typeof W.prototype, new W().m());
