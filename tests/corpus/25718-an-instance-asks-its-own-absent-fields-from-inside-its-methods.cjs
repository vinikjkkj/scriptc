// hasOwn (through a parameter), `in` and plain reads of absent-until-written fields asked from inside the class's own methods (the static receiver path).
class Box {
  constructor(a, b, c, d) { this.a = a; this.b = b; this.c = c; this.d = d; }
  sum() { return this.a + this.b + this.c + this.d; }
  hasMemo(o) { return Object.hasOwn(o, "memo"); }
  hasTag(o) { return Object.hasOwn(o, "tag"); }
  inMemo() { return "memo" in this; }
  fill() { if (this.memo === undefined) this.memo = this.sum(); return this.memo; }
  setTag(t) { this.tag = t; }
  report() { return [this.hasMemo(this), this.hasTag(this), this.inMemo(), this.memo, this.tag].join(" "); }
}
Box.prototype.memo = undefined;
Box.prototype.tag = "no-tag";
const b = new Box(1, 2, 3, 4);
console.log(b.report());
b.fill();
console.log(b.report());
b.setTag("T");
console.log(b.report());
b.setTag(undefined);
console.log(b.report());
console.log(new Box(9, 9, 9, 9).report());
