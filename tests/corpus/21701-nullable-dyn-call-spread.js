// Spread arguments are part of the argument list: a nullish receiver of
// the member call throws at the read, before the spread evaluates.
let n = 0;
function se(v) { console.log("se", v); n += 1; return v; }
function probe(label, fn) {
  try { const r = fn(); console.log(label, "ok", r); }
  catch (e) { console.log(label, e.constructor.name, e.message, "n=" + n); }
}
let u;
let nul = null;
probe("spread call", () => u.call(...[se("this"), se("arg")]));
probe("spread apply", () => u.apply(...[se("this"), se("arg")]));
probe("spread method", () => u.m(...[se("a"), se("b")]));
probe("mixed spread", () => u.m(se("a"), ...[se("b")]));
probe("null spread call", () => nul.call(se("t"), ...[se("x")]));
probe("no-arg call", () => u.call());
console.log("total", n);
