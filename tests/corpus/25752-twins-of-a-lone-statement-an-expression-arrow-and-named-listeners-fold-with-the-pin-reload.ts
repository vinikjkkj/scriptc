// Lone-statement, expression-bodied and named-function registrations place their twins differently; all are twinned in the one reload that carries the pins.
import { EventEmitter } from "node:events";

class Box extends EventEmitter {
  n = 0;
  label = "a";
}
const b = new Box();
const loose: any = b;
loose.n = "str";
const hold: { v: any } = { v: b };

function onThing(v: number): void { console.log("thing", typeof v, v + 1); }
const onArrow = (s: string): void => { console.log("arrow", typeof s, s + "!"); };

if (process.argv.length > 0) b.on("lone", (v: number) => { console.log("lone", typeof v, v + 1); });
else b.on("never", (v: number) => { console.log("never", v); });
const reg = (): Box => b.on("expr", (v: number) => { console.log("expr", typeof v, v * 2); });
reg();
b.on("thing", onThing);
b.on("thing2", onThing);
b.on("arrow", onArrow);
for (let i = 0; i < 1; i++) b.on("loop", (v: number) => { console.log("loop", typeof v, v - 1); });
const em = hold.v;
em.emit.apply(em, ["lone", "4"]);
em.emit.apply(em, ["expr", "5"]);
em.emit.apply(em, ["thing", "6"]);
em.emit.apply(em, ["thing2", "7"]);
em.emit.apply(em, ["arrow", 8]);
em.emit.apply(em, ["loop", "9"]);
console.log(String(loose.n), b.label);
