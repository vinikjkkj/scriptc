// Node reads the callee's member BEFORE it evaluates the call's arguments:
// a nullish receiver throws at the read, and the arguments never run.
let n = 0;
function se(v) { console.log("se", v); n += 1; return v; }
function probe(label, fn) {
  try { const r = fn(); console.log(label, "ok", r); }
  catch (e) { console.log(label, e.constructor.name, e.message, "n=" + n); }
}
let u;
let nul = null;
function run(recv, tag) {
  probe(tag + " call", () => recv.call(se("this"), se("arg")));
  probe(tag + " apply", () => recv.apply(se("this"), [se("arg")]));
  probe(tag + " bind", () => recv.bind(se("this"))(se("arg")));
  probe(tag + " method", () => recv.m(se("arg")));
}
run(u, "undef");
run(nul, "null");
probe("local undefined call", () => u.call(se("t"), se("a")));
console.log("total", n);
