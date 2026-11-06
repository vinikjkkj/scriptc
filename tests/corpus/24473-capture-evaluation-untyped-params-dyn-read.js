function dd(o, k) { return o[k]; }
// untyped params (implicit-any generic methods)
function make(prefix, n) {
  class C {
    constructor() { this.v = n; }
    add(x) { return prefix + x + n; }
    both(x) { return prefix + x + this.v; }
    noop() { return 7; }
  }
  return new C();
}
const a = make("p", 1), b = make("q", 2);
const add = dd(a, "add"), both = dd(a, "both"), noop = dd(a, "noop");
console.log(add("-"));
console.log(add.call(b, "-"));
try { console.log(both("-")); } catch (e) { console.log("T", e.name); }
console.log(both.call(b, "-"));
console.log(noop(), noop.call(b));
console.log(a.add === make("p", 1).add, a.add === a.add, a.add === b.add);
console.log(add.apply(b, ["+"]), add.bind(b, "*")());
