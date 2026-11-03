/* eslint-disable @typescript-eslint/no-explicit-any -- dynamic emits reach typed listeners on purpose */
import { EventEmitter } from "events";
const bus = new EventEmitter();
function fire(x: any, name: string, ...a: unknown[]) { return x.emit(name, ...a); }
const h = (n: number) => { return n + 1; };
bus.on("a", h);
bus.on("b", function named(n: number) { return n * 2; });
bus.on("c", (n: number) => {
  bus.on("d", (m: number) => m + n);
  return n;
});
fire(bus, "a", "s");
console.log(String(h));
console.log(String(bus.listeners("b")[0]));
console.log(String(bus.listeners("c")[0]));
console.log(String(bus.listeners("a")[0]), (bus.listeners("a")[0] as any).name, (bus.listeners("c")[0] as any).length);
fire(bus, "c", 1);
console.log(bus.listeners("d").length);
