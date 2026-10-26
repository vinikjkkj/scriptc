// A base method whose body returns nothing; a subclass override returns a value.
// Calls through the base type answer the override's value; the base body answers undefined.
class B {
  m(x) { this.last = x; }
  n(x, y) { if (x) return; this.n2 = y; }
}
class S extends B {
  m(x) { return "S:" + x; }
  n(x, y) { return y === undefined ? "noy" : "y=" + y; }
}
const b = new S();
const v = b.m(3);
console.log(v, b.last === undefined ? "nolast" : "last");
console.log(b.n(1, 2), b.n(0), new B().m(4), new B().n(0, 5));
const plain = new B();
const pv = plain.m(9);
console.log(pv === undefined ? "u" : "d", plain.last);
