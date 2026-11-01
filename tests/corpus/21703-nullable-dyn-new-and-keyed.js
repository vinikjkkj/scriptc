// `new X(args)` and `o[k](args)`: a nullish X throws at construction (the
// arguments evaluate first, as Node does); a nullish receiver of the keyed
// read throws after the key evaluates and before the arguments.
let n = 0;
function se(v) { console.log("se", v); n += 1; return v; }
function probe(label, fn) {
  try { const r = fn(); console.log(label, "ok", r); }
  catch (e) { console.log(label, e.constructor.name, e.message, "n=" + n); }
}
function build(X, tag) {
  probe(tag + " new", () => new X(se("arg")));
}
build(undefined, "undef");
build(null, "null");
build(1, "num");
let u;
probe("keyed read", () => u[se("k")](se("arg")));
probe("keyed no-arg", () => u[se("k2")]());
const o = {};
probe("new missing", () => new o.nope(se("arg")));
console.log("total", n);
