// util.format's %s over user toString answers that are not plain strings
// (String converts a number or boolean result, and a throw propagates), over a
// class whose user toString the lowering can call, and over a class named like
// a Node built-in (Node inspects it, since hasBuiltInToString sees a built-in
// constructor name).
import { format } from "node:util";

console.log(format("%s", { toString() { return 5; } }));
console.log(format("%s", { toString() { return true; } }));
console.log(format("%s", { toString() { return -0; } }));
try {
  console.log(format("%s", { toString() { throw new RangeError("bad"); } }));
} catch (e) {
  console.log("T", (e as Error).name, (e as Error).message);
}
console.log(format("%s", { [Symbol.toPrimitive](h: string) { return "P:" + h; }, toString() { return "S"; } }));
class A { toString() { return "A"; } }
class B extends A { toString() { return "B" + super.toString(); } }
console.log(format("%s", new B()));
class Map { toString() { return "MAP"; } }
console.log(format("%s|", new Map()));
const u: number | { toString(): string } = Math.random() < 2 ? -0 : { toString() { return "R"; } };
console.log(format("%s", u));
