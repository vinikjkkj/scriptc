// A method of an instance held in a field of a class that crosses into untyped code is reachable by NAME from that code:
// by a call, by destructuring the key, by reading it as a value, by `in`. Each of these must find the method.
class Q {
  constructor() { this.n = 3; }
  label() { return "L"; }
  twice() { return this.n * 2; }
  unused() { return "unused"; }
}
class C { constructor() { this.q = new Q(); } }
const c = new C();
function viaDestructuring(o) { const { twice, label } = o.q; return twice.call(o.q) + ":" + typeof label; }
function viaValueRead(o) { const f = o.q.unused; return f.call(o.q); }
function viaIn(o) { return ["label" in o.q, "twice" in o.q, "unused" in o.q, "nope" in o.q].join(","); }
console.log(viaDestructuring(c), viaValueRead(c), viaIn(c));
