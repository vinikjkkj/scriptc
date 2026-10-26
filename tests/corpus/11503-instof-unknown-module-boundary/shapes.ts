export class Shape {
  sides = 0;
}
export class Square extends Shape {
  sides = 4;
}
export class Blob {
  sides = -1;
}
export function build(kind: string): unknown {
  if (kind === "square") return new Square();
  if (kind === "shape") return new Shape();
  if (kind === "blob") return new Blob();
  return { sides: 4 };
}
