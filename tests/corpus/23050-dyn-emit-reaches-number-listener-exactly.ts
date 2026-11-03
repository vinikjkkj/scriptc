/* eslint-disable @typescript-eslint/no-explicit-any, prefer-spread -- dynamic emits reach typed listeners on purpose */
import { EventEmitter } from "events";
// A typed listener reached by a dynamic emit receives the value exactly as Node passes it, whatever the declared type.
const bus = new EventEmitter();
bus.on("num", (n: number) => {
  console.log("num", typeof n, n, n + 1, n * 2, n + "x", `${n}`, n === 7, n == 7, n > 3, n < 3, n !== n);
});
function fire(x: any, name: string, ...args: unknown[]) { return x.emit(name, ...args); }
console.log(bus.emit("num", 7));
console.log(fire(bus, "num", 7));
for (const v of ["7", undefined, null, true, { a: 1 }, [1, 2], "abc", 1.5, -0, NaN, "", 0n === undefined]) {
  console.log(fire(bus, "num", v));
}
console.log(fire(bus, "num"));
function applyIt(x: any, args: any[]) { return x.emit.apply(x, args); }
console.log(applyIt(bus, ["num", "9"]));
console.log(bus.emit("num", 8));
