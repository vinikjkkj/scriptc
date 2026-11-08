// a class prototype that gained an enumerable property by assignment: for-in over an instance visits it after the own keys; methods stay hidden
class Shape {
  constructor() { this.sides = 3; }
  describe() { return "shape"; }
}
Shape.prototype.tag = "inherited";
const s = new Shape();
const seen = [];
for (const k in s) seen.push(k);
console.log(seen.join(","));
class Sub extends Shape {
  constructor() { super(); this.extra = 1; }
}
const t = new Sub();
const seen2 = [];
for (const k in t) seen2.push(k);
console.log(seen2.join(","));
