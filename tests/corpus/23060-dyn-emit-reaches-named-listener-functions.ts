/* eslint-disable @typescript-eslint/no-explicit-any, prefer-spread -- dynamic emits reach typed listeners on purpose */
import { EventEmitter } from "events";
function fire(x: any, name: string, ...args: unknown[]) { return x.emit(name, ...args); }
const bus = new EventEmitter();
function onNum(n: number) { console.log("decl", typeof n, n, n + 1); }
const onStr = (s: string) => console.log("arrow", typeof s, s, s + 1);
bus.on("a", onNum);
bus.on("b", onNum);
bus.on("c", onStr);
bus.emit("a", 1);
bus.emit("b", 2);
bus.emit("c", "x");
fire(bus, "a", "s");
fire(bus, "b", null);
fire(bus, "c", 7);
bus.off("a", onNum);
console.log(bus.listenerCount("a"), bus.listenerCount("b"), bus.listenerCount("c"));
fire(bus, "a", "gone");
fire(bus, "b", [5]);
