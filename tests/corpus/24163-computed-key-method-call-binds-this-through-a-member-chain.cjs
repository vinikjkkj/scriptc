// `o.q[key]()`: the key names the method only at run time, and the call binds `this` to the instance read from the member chain,
// whether the receiver is an untyped value, a typed instance, or a local. The key may be a string, a number-like or an untyped value.
class Q {
  constructor() { this.n = 3; }
  alpha() { return "a" + this.n; }
  beta(x) { return "b" + this.n + x; }
  static gamma() { return "g"; }
}
class C { constructor() { this.q = new Q(); this.list = [new Q(), new Q()]; } }
function viaUntyped(o, key) { return o.q[key](); }
function viaLocal(o, key) { const q = o.q; return q[key](); }
function viaArray(o, key) { return o.list[1][key](); }
function viaArg(o, key) { return o.q[key]("!"); }
const c = new C();
const typed = new Q();
const names = ["alpha", "beta"];
console.log(viaUntyped(c, "alpha"), viaLocal(c, "alpha"), viaArray(c, names[0]), viaArg(c, names[1]));
console.log(typed[names[0]](), typed["be" + "ta"]("?"));
const holder = { inner: typed };
console.log(holder.inner[names[0]](), holder["inner"][names[1]]("#"));
