// A class declared in a package's `.d.ts` whose `.js` twin defines it. The
// declaration is the type surface; the twin's class is the ONE class the
// binary holds, so a construction, a method, a static, a field, `instanceof`,
// an `extends` and a parameter typed by the class all answer for the same
// thing. Each line below crossed the boundary as a refusal before.
import { Box, LIMIT, Other, twice } from "twinpkg";

const b = new Box(4);
console.log("get=" + String(b.get()));
console.log("limit=" + String(LIMIT) + " twice=" + String(twice(21)));
console.log("make=" + String(Box.make(9).get()) + " kind=" + Box.KIND);
const o = new Other();
console.log(o.tag());
console.log(String(o instanceof Box) + String(b instanceof Other) + String(o instanceof Other));
console.log("v=" + String(b.v));
b.v = 11;
console.log("v2=" + String(b.get()));

// A program class extending the declared class: `super` reaches the twin.
class Mine extends Box {
  constructor() {
    super(LIMIT + 1);
  }
  override get(): number {
    return super.get() * 2;
  }
}
const m = new Mine();
console.log("mine=" + String(m.get()) + String(m instanceof Box) + String(m.v));

// A parameter typed by the declared class takes a twin instance and a subclass.
function use(x: Box): number {
  return x.get();
}
console.log(String(use(m) + use(new Box(1)) + use(o)));
