// String(V) / ${V} / V.toString() of a class value held in dyn print the class source text exactly as Node does
// (declared and evaluated, JavaScript source).
function anyv(x) { return x; }
class A { static s = 5; constructor(a) { this.a = a; }
  m() { return 1; } }
const mk = (n = 0) => class Made extends A { static n = n; /* c */ get g() { return 2; } };
const h = {}; h.M = mk(1);
const M = anyv(h.M);
console.log(String(anyv(A)));
console.log(String(M));
console.log(`${M}`, M.toString() === String(M), (anyv(class {})) + "");
console.log([A, M].map(String).join("|"));
