// The overflow array is created by whichever store comes first: a lane field given a string (overflow) or an absent-until-written field being written. Every unwritten
// absent entry must still read as absent (the prototype value, not an own undefined), and every written one as its value, in both orders.
class Cell {
  constructor(a, b, c, d) {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
  }
  total() { return this.a + this.b + this.c + this.d; }
  setX(v) { this.x = v; }
  setY(v) { this.y = v; }
  setZ(v) { this.z = v; }
}
Cell.prototype.x = "px";
Cell.prototype.y = "py";
Cell.prototype.z = "pz";
const report = (t, o) => console.log(t, o.a, o.b, o.x, o.y, o.z, Object.hasOwn(o, "x"), Object.hasOwn(o, "y"), Object.hasOwn(o, "z"), Object.keys(o).join(","));
const laneFirst = new Cell("str", 2, 3, 4);
report("lane-overflow", laneFirst);
laneFirst.setY("wy");
report("then-y", laneFirst);
const coldFirst = new Cell(1, 2, 3, 4);
coldFirst.setZ(undefined);
report("z-undef", coldFirst);
coldFirst.setX(5);
report("then-x", coldFirst);
const both = new Cell(1.5, -2, 3, NaN);
both.setX("a");
both.setY("b");
both.setZ("c");
report("all", both);
const none = new Cell(1, 2, 3, 4);
report("none", none);
console.log(none.total(), laneFirst.b + laneFirst.c, both.c);
