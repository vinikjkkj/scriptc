// util.format's %s over a class instance held in `any`: when the class
// (or a user base) DECLARES toString, Node's formatter converts the value
// with String(arg) instead of inspecting it. The dyn box carries the
// class's member table, so the call reaches the user method. A class with
// only data members (or only valueOf) still inspects. Node prints
// "Named!", "Child!" and "Plain { n: 1 }" for the three %s rows, and
// the console.log %s row prints the same as format.
import { format } from "node:util";

class Named {
  toString(): string {
    return "Named!";
  }
}

class Base {
  toString(): string {
    return "Child!";
  }
}

class Child extends Base {
  extra = 1;
}

class Plain {
  n = 1;
}

const a: any = new Named();
const c: any = new Child();
const p: any = new Plain();

console.log(format("%s", a));
console.log(format("%s|%s", c, p));
console.log("%s", a);
console.log("[" + format("%s", a) + "]");
