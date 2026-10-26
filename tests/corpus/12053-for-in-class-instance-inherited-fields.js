// A derived instance lists the base fields first (the base constructor
// creates them), then its own, and a base-typed walk sees the same order.
class Shape {
  kind = 'shape';
  sides = 0;
  describe() {
    let out = '';
    for (const k in this) out += k + ';';
    return out;
  }
}
class Square extends Shape {
  side = 2;
  sides = 4;
}
const sq = new Square();
const names = [];
for (const k in sq) names.push(k);
console.log(names.join(','));
console.log(sq.describe());
console.log(new Shape().describe());
