// The TypeScript face of 8020: typed local classes with fields, accessors and
// inheritance that capture nothing and are only constructed.
function area(w: number, h: number): number {
  class Shape {
    w: number;
    h: number;
    constructor(w: number, h: number) {
      this.w = w;
      this.h = h;
    }
    get area(): number {
      return this.w * this.h;
    }
  }
  class Square extends Shape {
    constructor(s: number) {
      super(s, s);
    }
    describe(): string {
      return `square ${this.w} area ${this.area}`;
    }
  }
  console.log(new Square(w).describe());
  return new Shape(w, h).area;
}
console.log(area(3, 4));
console.log(area(5, 6));

function counter(): number[] {
  class Counter {
    private n = 0;
    next(): number {
      return ++this.n;
    }
  }
  const c = new Counter();
  return [c.next(), c.next(), new Counter().next()];
}
console.log(counter(), counter());
