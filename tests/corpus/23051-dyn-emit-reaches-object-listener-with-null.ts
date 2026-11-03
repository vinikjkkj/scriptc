/* eslint-disable @typescript-eslint/no-explicit-any, prefer-spread -- dynamic emits reach typed listeners on purpose */
import { EventEmitter } from "events";
const bus = new EventEmitter();
bus.on("obj", (r: { a: number; b: string }) => {
  try {
    console.log("obj", typeof r, r.a, r.b);
  } catch (e) {
    console.log("obj threw", (e as Error).constructor.name, (e as Error).message);
  }
});
function fire(x: any, name: string, ...args: unknown[]) { return x.emit(name, ...args); }
bus.emit("obj", { a: 1, b: "x" });
for (const v of [null, undefined, "str", 5, [1], { a: "s" }, { b: 2 }, {}]) fire(bus, "obj", v);
fire(bus, "obj");
bus.emit("obj", { a: 2, b: "y" });
