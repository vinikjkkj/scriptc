/* eslint-disable @typescript-eslint/no-explicit-any, prefer-spread -- dynamic emits reach typed listeners on purpose */
import { EventEmitter } from "events";
const bus = new EventEmitter();
bus.on("rest", (...xs: number[]) => console.log("rest", xs.length, xs, xs.map((x) => typeof x), xs.map((x) => x + 1)));
bus.on("rest2", (head: string, ...tail: number[]) => console.log("rest2", typeof head, head, tail.length, tail));
function fire(x: any, name: string, ...args: unknown[]) { return x.emit(name, ...args); }
fire(bus, "rest", 1, 2);
fire(bus, "rest", "a", undefined, null);
fire(bus, "rest");
fire(bus, "rest2", 1, "b", 3);
fire(bus, "rest2");
