// An untyped site that names a member by a COMPUTED key may reach any method of the instances the boxed class holds.
class Q {
  constructor() { this.n = 3; }
  alpha() { return "a" + this.n; }
  beta() { return "b" + this.n; }
}
class C { constructor() { this.q = new Q(); } }
const c = new C();
function pick(o, key) { const q = o.q; return q[key](); }
const names = ["alp", "bet"];
console.log(pick(c, names[0] + "ha"), pick(c, names[1] + "a"));
