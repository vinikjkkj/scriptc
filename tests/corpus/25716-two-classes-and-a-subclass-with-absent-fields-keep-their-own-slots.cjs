// Two unrelated classes with absent-until-written fields of the same names, a subclass of one (a subclass is never narrowed), and a class whose only narrow fields are four
// absent-until-written ones (no lane at all): each instance keeps its own slots.
class P {
  constructor(a, b, c, d) { this.a = a; this.b = b; this.c = c; this.d = d; }
  sum() { return this.a + this.b + this.c + this.d; }
  setX(v) { this.x = v; }
}
P.prototype.x = "px";
class Q {
  constructor(a, b, c, d) { this.a = a; this.b = b; this.c = c; this.d = d; }
  sum() { return this.a * this.b * this.c * this.d; }
  setX(v) { this.x = v; }
  setY(v) { this.y = v; }
}
Q.prototype.x = "qx";
Q.prototype.y = "qy";
class R extends P {
  constructor(a, b, c, d, e) { super(a, b, c, d); this.e = e; }
  extra() { return this.sum() + this.e; }
}
const p = new P(1, 2, 3, 4);
const q = new Q(1, 2, 3, 4);
const r = new R(1, 2, 3, 4, 5);
console.log(p.x, q.x, q.y, r.x, Object.keys(p).join(","), Object.keys(q).join(","), Object.keys(r).join(","));
p.setX("P!");
q.setX("Q!");
q.setY("Y!");
r.setX("R!");
console.log(p.x, q.x, q.y, r.x, Object.keys(p).join(","), Object.keys(q).join(","), Object.keys(r).join(","), p.sum(), q.sum(), r.extra());
class Lone {
  constructor(id) { this.id = id; }
  setA(v) { this.fa = v; }
  setB(v) { this.fb = v; }
  setC(v) { this.fc = v; }
  setD(v) { this.fd = v; }
}
Lone.prototype.fa = "da";
Lone.prototype.fb = undefined;
Lone.prototype.fc = "dc";
Lone.prototype.fd = undefined;
const l = new Lone("one");
console.log(l.id, l.fa, l.fb, l.fc, l.fd, Object.keys(l).join(","));
l.setC("C!");
l.setB(undefined);
console.log(l.id, l.fa, l.fb, l.fc, l.fd, Object.keys(l).join(","));
const l2 = new Lone("two");
l2.setD(4);
l2.setA("A!");
console.log(l2.id, l2.fa, l2.fb, l2.fc, l2.fd, Object.keys(l2).join(","), l.fd, l.fa);
