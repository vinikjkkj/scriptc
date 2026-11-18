// util.inspect through console.log of instances whose absent-until-written fields are unwritten, written, and written out of declaration order.
class Pt {
  constructor(a, b, c, d) { this.a = a; this.b = b; this.c = c; this.d = d; }
  sum() { return this.a + this.b + this.c + this.d; }
  setU(v) { this.u = v; }
  setV(v) { this.v = v; }
}
Pt.prototype.u = undefined;
Pt.prototype.v = "pv";
const p = new Pt(1, 2, 3, 4);
console.log(p);
p.setV("vv");
console.log(p);
p.setU(5);
console.log(p);
const q = new Pt(1.5, -2, "x", null);
q.setU(undefined);
q.setV(0);
console.log(q);
console.log([p, q].length, p.sum(), q.v);
