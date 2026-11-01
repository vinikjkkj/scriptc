// Control: the guarded forms evaluate exactly what Node evaluates.
let n = 0;
function se(v) { console.log("se", v); n += 1; return v; }
function guarded(u) {
  if (u) return u.call(se("this"), se("arg"));
  return "skipped";
}
console.log(guarded(undefined));
console.log(guarded(function (a) { return "live " + a; }));
function fallback(u) {
  const g = u || { call(t, a) { return "fallback " + a; } };
  return g.call(se("this"), se("arg"));
}
console.log(fallback(undefined));
const live = (x) => "live " + x;
console.log(live.call(null, se("p")));
console.log("total", n);
