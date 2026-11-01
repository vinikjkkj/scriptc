// Control: a receiver that is NOT nullish reads its member first, the
// arguments then evaluate, and only the call throws "is not a function".
let n = 0;
function se(v) { console.log("se", v); n += 1; return v; }
function probe(label, fn) {
  try { const r = fn(); console.log(label, "ok", r); }
  catch (e) { console.log(label, e.constructor.name, e.message, "n=" + n); }
}
function run(recv, tag) {
  probe(tag + " call", () => recv.call(se("this"), se("arg")));
  probe(tag + " method", () => recv.m(se("arg")));
  probe(tag + " callee", () => recv(se("arg")));
  probe(tag + " new", () => new recv(se("arg")));
}
run(1, "num");
run({ m: 1 }, "obj");
const o = { f(x) { return ["f", x]; } };
probe("missing method", () => o.nope(se("arg")));
probe("present method", () => o.f(se("arg")));
console.log("total", n);
