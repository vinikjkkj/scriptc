import { format } from "node:util";

interface Shape { area(): number }

class Box implements Shape {
  private side: number;
  public label!: string;
  constructor(side: number) {
    this.side = side;
  }
  area(): number {
    return this.side * this.side;
  }
  static make<T>(x: T): Box {
    return new Box(3);
  }
}

const box = new Box(2);
const area = (): number => box.area();
function multi(
  a: {
    x: number;
    y: string;
  },
  b?: number[],
): void {
  return;
}
const cast = (v: unknown) => (v as number) + 1;
const nonNull = (v: number | null) => v! + 1;

console.log(format("%s", area));
console.log(format("%s", box.area()));
console.log(String(multi));
console.log(`${cast}`);
console.log(nonNull.toString());
