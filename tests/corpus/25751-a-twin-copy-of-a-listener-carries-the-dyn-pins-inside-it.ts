// The pin reload wraps field initializers in `any`; a listener whose body declares such a class must carry those wrappers in its erased twin.
import { EventEmitter } from "node:events";

class Box extends EventEmitter {
  n = 0;
  label = "a";
}

const b = new Box();
const loose: any = b;
loose.n = "str";
const hold: { v: any } = { v: b };

// pins before, inside and after the listeners
class Pre { n = 1; m = 2; }
b.on("x", (v: number) => {
  class Loc { n = 3; k = v; }
  const l = new Loc();
  const bag: { v: any } = { v: l };
  console.log(typeof bag.v.k);
  console.log("typed", typeof v, v + 1, l.n, l.k);
});
class Post { n = 4; }
b.on("y", (s: string, t: number) => {
  console.log("y", typeof s, typeof t, new Post().n, new Pre().n);
});
const em = hold.v;
em.emit.apply(em, ["x", "5"]);
em.emit.apply(em, ["y", 1, "2"]);
console.log(String(loose.n), b.label);
