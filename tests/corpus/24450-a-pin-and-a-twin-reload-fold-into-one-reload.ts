/* eslint-disable @typescript-eslint/no-explicit-any -- the rows reach typed listeners through an untyped receiver and untyped writes on purpose */
// pin + twin, the pin OUTSIDE every twinned listener: the folded reload is taken
import { EventEmitter } from "events";
class Holder { n = 1; keep = 5; tag = "t"; }
function setN(x: any) { x.n = "str"; }
const h = new Holder();
setN(h);
const bus = new EventEmitter();
bus.on("num", (n: number) => { console.log("num", n + 1, h.n, h.keep); });
bus.on("pair", (a: string, c: number) => { console.log("pair", a, c, h.tag); });
function fire(x: unknown, name: string, ...args: unknown[]): unknown { return (x as any).emit(name, ...args); }
console.log(fire(bus, "num", 5), fire(bus, "pair", "q", 2), fire(bus, "num", "oops"));
