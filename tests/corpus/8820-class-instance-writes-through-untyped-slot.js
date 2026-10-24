// A class instance that reached an untyped slot takes writes: a declared
// field (checked into its slot), an inherited field, a setter (which runs)
// and a getter-only accessor (Node's TypeError). Each was a loud
// "a property write on a dynamic P is not supported yet" at run time.
'use strict';

class Base {
  constructor() { this.b = 1; }
  bm() { return "bm" + this.b; }
}
class P extends Base {
  constructor() { super(); this.n = 1; this.s = "a"; this.log = []; }
  get g() { return this.n * 10; }
  set g(v) { this.log.push("set" + v); this.n = v; }
  get ro() { return "ro"; }
  m() { return "m" + this.n; }
}

function t(name, f) {
  try { console.log(name, f()); } catch (e) { console.log(name, "THROW", e.name, e.message); }
}
function set(x, k, v) { x[k] = v; }

const p = new P();
function probe(x) {
  t("read n", () => x.n);
  t("write n", () => { x.n = 5; return x.n; });
  t("keyed write s", () => { set(x, "s", "z"); return x.s; });
  t("write inherited", () => { x.b = 7; return x.bm(); });
  t("setter runs", () => { x.g = 3; return x.g + ":" + x.log.join(); });
  t("static read after", () => p.n + "/" + p.s + "/" + p.b);
  t("getter-only write", () => { x.ro = 1; return x.ro; });
  t("in", () => ("n" in x) + "," + ("nope" in x));
  t("keys", () => Object.keys(x).join());
}
probe(p);
console.log(p.n, p.s, p.b, p.log.length);
