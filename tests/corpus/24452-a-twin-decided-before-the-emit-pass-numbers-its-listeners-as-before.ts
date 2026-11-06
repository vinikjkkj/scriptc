/* eslint-disable @typescript-eslint/no-explicit-any -- the row reaches typed listeners through an untyped receiver on purpose */
import { EventEmitter } from "events";
class Bus extends EventEmitter {
  label = "bus";
}
const bus = new Bus();
bus.on("a", (n: number) => console.log("a", n * 2));
bus.on("bb", (s: string, n: number) => console.log("bb", s.length, n));
bus.once("ccc", (r: { x: number; y: string }) => console.log("ccc", r.x, r.y));
function fire(x: unknown, name: string, ...args: unknown[]): unknown { return (x as any).emit(name, ...args); }
console.log(fire(bus, "a", 4), fire(bus, "bb", "str", 7), fire(bus, "ccc", { x: 1, y: "z" }), fire(bus, "ccc", { x: 2, y: "w" }));
console.log(fire(bus, "a", "not a number"), fire(bus, "bb", 5, "x"));
