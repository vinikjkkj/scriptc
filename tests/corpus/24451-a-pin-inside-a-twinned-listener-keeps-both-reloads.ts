/* eslint-disable @typescript-eslint/no-explicit-any -- the rows reach typed listeners through an untyped receiver and untyped writes on purpose */
// pin + twin, with the pin edit INSIDE a twinned listener (the fold must fall back)
import { EventEmitter } from "events";
class Holder { n = 1; keep = 5; }
function setN(x: any) { x.n = "str"; }
const h = new Holder();
setN(h);
const bus = new EventEmitter();
bus.on("num", (n: number) => { class Local { m = 2; } const l = new Local(); (l as any).m = "s"; console.log("num", n + 1, h.n, h.keep, l.m); });
function fire(x: unknown, name: string, ...args: unknown[]): unknown { return (x as any).emit(name, ...args); }
console.log(fire(bus, "num", 5), fire(bus, "num", "oops"));
