/* eslint-disable @typescript-eslint/no-explicit-any, prefer-spread -- dynamic emits reach typed listeners on purpose */
import { EventEmitter } from "events";
const bus = new EventEmitter();
bus.on("def", (n: number = 5, m: string = "d") => console.log("def", typeof n, n, typeof m, m));
function fire(x: any, name: string, ...args: unknown[]) { return x.emit(name, ...args); }
bus.emit("def", 3, "e");
fire(bus, "def");
fire(bus, "def", undefined, undefined);
fire(bus, "def", null, 7);
fire(bus, "def", "x", "y");
fire(bus, "def", 0, "");
