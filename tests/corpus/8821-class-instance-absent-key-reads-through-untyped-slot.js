// A class instance that reached an untyped slot answers a read of a key it
// does not have with undefined (Node's answer), and the Object.prototype
// members every object inherits. Each was a loud "a property read on a
// dynamic P is not supported yet" at run time.
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
  t("static read after", () => p.n + "/" + p.s + "/" + p.b);
  t("absent read", () => x.nope);
  t("absent keyed read", () => x["nope" + 1]);
  t("absent truthiness", () => (x.cache ? "has" : "none"));
  t("fallback chain", () => x.stack || x.message || "default");
  t("hasOwnProperty read", () => typeof x.hasOwnProperty);
  t("hasOwnProperty call", () => x.hasOwnProperty("n") + "," + x.hasOwnProperty("nope"));
  t("valueOf", () => x.valueOf() === x);
  t("in", () => ("n" in x) + "," + ("nope" in x));
  t("keys", () => Object.keys(x).join());
}
probe(p);
console.log(p.n, p.s, p.b, p.log.length);
