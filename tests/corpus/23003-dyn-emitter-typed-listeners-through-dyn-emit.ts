/* eslint-disable @typescript-eslint/no-explicit-any, prefer-spread -- the rows exercise untyped (any) receivers on purpose */
import { EventEmitter } from "events";
class Bus extends EventEmitter {
  label = "bus";
  tick(n: number): string { return this.label + n; }
}
class Other extends EventEmitter {}
const bus = new Bus();
const other = new Other();
bus.on("num", (n: number) => console.log("num", n));
bus.on("pair", (a: string, b: number) => console.log("pair", a, b));
bus.once("one", (s: string) => console.log("one", s));
bus.on("rec", (r: { a: number; b: string }) => console.log("rec", r.a, r.b));
bus.on("err2", (e: Error) => console.log("err2", e.message));
bus.on("error", (e: Error) => console.log("bus error", e.message));
bus.on("none", () => console.log("none called"));
other.on("num", (n: number) => console.log("other num", n));

function fire(x: unknown, name: string, ...args: unknown[]): unknown {
  const t = x as any;
  return t.emit(name, ...args);
}
console.log(fire(bus, "num", 5), fire(bus, "pair", "p", 2), fire(bus, "one", "x"), fire(bus, "one", "y"));
console.log(fire(bus, "rec", { a: 1, b: "z" }), fire(bus, "err2", new Error("e2")), fire(bus, "nolistener", 1));
console.log(fire(bus, "none"), fire(bus, "none", 1, 2, 3));
console.log(fire(other, "num", 7));
console.log(fire(bus, "error", new Error("E")));
function applyIt(x: any, args: any[]) { return x.emit.apply(x, args); }
console.log(applyIt(bus, ["num", 11]), applyIt(other, ["num", 12]));
// removal during emit: first listener removes the second
const em = new EventEmitter();
const second = () => console.log("second");
em.on("x", () => { console.log("first"); em.removeListener("x", second); });
em.on("x", second);
em.on("x", () => console.log("third"));
console.log(fire(em, "x"), fire(em, "x"));
// listener sees the emitter as this (JS function)
const em2 = new EventEmitter();
em2.on("t", () => console.log("t fired"));
fire(em2, "t");
function anyEmit(x: any) { return x.listenerCount("num") + ":" + x.eventNames().length + ":" + x.listeners("num").length; }
console.log(anyEmit(bus), anyEmit(other));
console.log(bus.tick(3), typeof (bus as any).tick, (bus as any).tick(4), (bus as any).label, (bus as any).missing);
