/* eslint-disable @typescript-eslint/no-explicit-any, prefer-spread -- dynamic emits reach typed listeners on purpose */
import { EventEmitter } from "events";
const bus = new EventEmitter();
bus.on("two", (a: string, b: number) => console.log("two", typeof a, a, typeof b, b, a + b));
function fire(x: any, name: string, ...args: unknown[]) { return x.emit(name, ...args); }
console.log(bus.emit("two", "a", 1));
fire(bus, "two", 1, "b");
fire(bus, "two");
fire(bus, "two", "z");
fire(bus, "two", "q", 2, "extra", 4);
fire(bus, "two", null, undefined);
