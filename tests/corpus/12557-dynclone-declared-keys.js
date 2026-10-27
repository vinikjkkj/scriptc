// Clone of a dyn-held class instance with declared fields only (no run-time
// property table): Object.keys of the copy lists the same keys in the same order.
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.label = "p" + x;
  }
  shift(d) {
    this.x = this.x + d;
    return this.x;
  }
}
function pass(v) {
  return v;
}
const p = pass(new Point(1, 2));
const q = Object.create(Object.getPrototypeOf(p), Object.getOwnPropertyDescriptors(p));
console.log(Object.keys(p).join(","), Object.keys(q).join(","));
console.log(Object.keys(q).join(",") === Object.keys(p).join(","));
console.log(q.shift(10), p.x, q.x, q.label, q instanceof Point);
console.log(JSON.stringify(q));
