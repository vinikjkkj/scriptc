/* eslint-disable @typescript-eslint/no-explicit-any, prefer-spread -- dynamic emits reach typed listeners on purpose */
import { EventEmitter } from "events";
function fire(x: any, name: string, ...args: unknown[]) { return x.emit(name, ...args); }
const bus = new EventEmitter();
bus.once("outer", (n: number) => {
  console.log("outer", typeof n, n);
  bus.on("inner", (m: number) => console.log("inner", typeof m, m, m + n));
});
fire(bus, "outer", "o");
fire(bus, "inner", 1);
fire(bus, "inner", "i");
bus.emit("inner", 5);
