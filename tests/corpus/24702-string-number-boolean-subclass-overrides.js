class Loud extends String {
  constructor(s) { super(s); }
  toString() { return "LOUD:" + this.valueOf(); }
  shout() { return this.toUpperCase(); }
  get2() { return this.length; }
}
const l = new Loud("abc");
console.log(String(l), `${l}`, l + "", l.valueOf(), l.toString(), l.shout(), l.get2());
class Plain extends String { constructor() { super(); } }
const p = new Plain();
console.log(p.length, String(p), JSON.stringify(p), p);
class Und extends String { constructor(x) { super(x); } }
console.log(String(new Und(undefined)), String(new Und(42)), String(new Und(null)), new Und(true).length);
class N extends Number { constructor(x, tag) { super(x); this.tag = tag; } double() { return this.valueOf() * 2; } }
const n = new N(21, "t");
console.log(n + 1, n.double(), n.tag, n instanceof N, n instanceof Number, typeof n, JSON.stringify(n), Object.prototype.toString.call(n), n);
console.log(n.toFixed(2), `${n}`, String(n), n > 20);
class B extends Boolean { constructor(x) { super(x); } }
const b = new B(false);
console.log(b ? "truthy" : "falsy", b.valueOf(), b instanceof Boolean, String(b), b);
const v = new Loud("xyz");
console.log(Object.getPrototypeOf(v) === Loud.prototype, Object.getPrototypeOf(Loud.prototype) === String.prototype, v.constructor === Loud, v.constructor.name);
console.log(Object.keys(v), Object.getOwnPropertyNames(Loud.prototype));
try { Loud("x"); } catch (e) { console.log(e instanceof TypeError, e.message); }
try { N(1, "x"); } catch (e) { console.log(e.message); }
