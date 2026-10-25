// A staged subclass chain: super() and super.m() across the chain, and a base write.
class Base {
  constructor(x) { this.x = x; }
  get() { return this.x; }
}
class Sub extends Base {
  constructor(x, y) { super(x); this.y = y; }
  get() { return super.get() + 100; }
  sum() { return this.x + this.y; }
}
Base.prototype.get = function () { return this.x * 2; };
const s = new Sub(3, 4);
console.log(s.get(), s.sum(), new Base(5).get(), s instanceof Base);
