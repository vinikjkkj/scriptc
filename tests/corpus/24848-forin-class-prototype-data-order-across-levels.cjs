// class prototype data written at two levels: for-in lists the subclass's prototype first, then the base's, per level in write order
class Shape {
  constructor() { this.sides = 3; }
  describe() { return "shape"; }
}
Shape.prototype.tag = "inherited";
Shape.prototype.color = "red";
class Sub extends Shape {
  constructor() { super(); this.extra = 1; }
}
Sub.prototype.subTag = "sub-inherited";
Sub.prototype.shine = "matte";
class Leaf extends Sub {
  constructor() { super(); this.leafy = true; }
}
Leaf.prototype.leafTag = "leaf-inherited";
for (const inst of [new Shape(), new Sub(), new Leaf()]) {
  const seen = [];
  for (const k in inst) seen.push(k);
  console.log(seen.join(","));
}
