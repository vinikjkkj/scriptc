// Reflect.construct over a class, with the target as newTarget (the only
// newTarget the lowering accepts): the instance is a real instance of it.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  norm(): number {
    return this.x + this.y;
  }
}

const p = Reflect.construct(Point, [1, 2]);
console.log(p.x, p.y, p.norm(), p instanceof Point);
const q = Reflect.construct(Point, [3, 4], Point);
console.log(q.x, q.y, q instanceof Point);
