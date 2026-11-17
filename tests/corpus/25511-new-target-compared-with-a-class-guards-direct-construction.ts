// The abstract-class idiom: a base constructor refuses direct construction by comparing new.target with itself.
class Shape {
  readonly sides: number;
  constructor(sides: number) {
    if (new.target === Shape) throw new Error("Shape is abstract");
    this.sides = sides;
  }
}
class Square extends Shape { constructor() { super(4); } }
class Triangle extends Shape { constructor() { super(3); } }
function tryMake(f: () => Shape): string {
  try { return "ok:" + f().sides; } catch (e) { return "threw:" + (e as Error).message; }
}
console.log(tryMake(() => new Shape(0)), tryMake(() => new Square()), tryMake(() => new Triangle()));
class Strict {
  constructor() { console.log(new.target !== Strict, new.target === Strict, !new.target); }
}
class Loose extends Strict {}
new Strict();
new Loose();
