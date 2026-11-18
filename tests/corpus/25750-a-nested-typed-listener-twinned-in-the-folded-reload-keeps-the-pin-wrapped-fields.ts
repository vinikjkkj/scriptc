// A typed listener registered on an emitter a dynamic emit can reach is twinned; the twins fold into the pin reload and a nested listener is twinned inside its outer twin.
import { EventEmitter } from "node:events";

class Box extends EventEmitter {
  n = 0;
  label = "a";
  bump(): void { this.n++; }
}

const b = new Box();
const loose: any = b;
loose.n = "str";
const hold: { v: any } = { v: b };

b.on("x", (v: number) => {
  console.log("typed", typeof v, v + 1);
});
b.on("y", (s: string, t: number) => {
  const inner = new Box();
  inner.on("z", (q: number) => { console.log("inner", typeof q, q * 2); });
  hold.v.emit.apply(inner, ["z", "7"]);
  console.log("y", typeof s, typeof t);
});
const em = hold.v;
em.emit.apply(em, ["x", "5"]);
em.emit.apply(em, ["y", 1, "2"]);
console.log(String(loose.n), b.label);
