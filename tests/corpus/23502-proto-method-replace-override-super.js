// A subclass override keeps its own method; its super.m() reaches the replacement; a base-typed receiver of a derived instance.
class Base {
  constructor(v) { this.v = v; }
  m() { return "Base.m:" + this.v; }
  who() { return this.m(); }
}
class Over extends Base {
  m() { return "Over.m>" + super.m(); }
}
class Plain extends Base {}
const o = new Over(1), p = new Plain(2), b = new Base(3);
console.log(o.m(), p.m(), b.m(), o.who(), p.who(), b.who());
Base.prototype.m = function () { return "NEW:" + this.v; };
const o2 = new Over(4), p2 = new Plain(5), b2 = new Base(6);
console.log(o.m(), p.m(), b.m(), o2.m(), p2.m(), b2.m());
console.log(o.who(), p.who(), b.who(), o2.who(), p2.who(), b2.who());
const arr = [o, p, b, o2, p2, b2];
console.log(arr.map((x) => x.m()).join("|"));
Base.prototype.m = function () { return "NEWER:" + this.v; };
console.log(arr.map((x) => x.who()).join("|"));
