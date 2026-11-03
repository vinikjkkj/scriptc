// A TYPED method (declared parameter and result types) replaced by a function of the same shape; the class is reached through a base.
class Shape {
  w: number;
  constructor(w: number) { this.w = w; }
  area(h: number): number { return this.w * h; }
  name(): string { return "shape"; }
}
class Sq extends Shape { name(): string { return "sq"; } }
const s = new Shape(2), q = new Sq(3);
console.log(s.area(5), q.area(5), s.name(), q.name());
(Shape.prototype as any).area = (h: number): number => h * 100;
console.log(s.area(5), q.area(5), new Shape(1).area(1), new Sq(1).area(1));
const shapes: Shape[] = [s, q, new Sq(7), new Shape(8)];
let total = 0;
for (const sh of shapes) total += sh.area(2);
console.log(total, shapes.map((x) => x.name()).join(","));
