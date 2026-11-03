// An evaluated class value crossing into dyn in a program that also reads `prototype` of a dynamic value: the per-evaluation
// prototype object (methods, base link, identity) is not modeled, so the crossing keeps the compile-time refusal.
function anyv(x) { return x; }
const mk = (n = 0) => class W { static n = n; m() { return 1; } };
const h = {};
h.W = mk(1);
const W = anyv(h.W);
console.log(typeof W.prototype);
