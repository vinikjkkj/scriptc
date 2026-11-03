/* eslint-disable @typescript-eslint/no-explicit-any, prefer-spread -- dynamic emits reach typed listeners on purpose */
import { EventEmitter } from "events";
// A listener that has an erased twin is still THE function the program registered: listeners(), rawListeners(),
// includes/indexOf, off through the value listeners() answered, listenerCount(name, fn) and the removeListener
// meta argument all show the original; only a dynamic emit dispatches to the twin.
function fire(x: any, name: string, ...args: unknown[]) { return x.emit(name, ...args); }
const bus = new EventEmitter();
const busAny: any = bus;
const handler = (n: number) => console.log("handler", typeof n, n);
const other = (n: number) => console.log("other", typeof n, n);
bus.on("a", handler);
bus.on("a", other);
bus.on("b", handler);
const ls = busAny.listeners("a");
console.log(ls.length, ls[0] === handler, ls[1] === other, ls[0] === ls[1], ls.includes(handler), ls.indexOf(other));
const raw = busAny.rawListeners("a");
console.log(raw.length, raw[0] === handler, raw.includes(other));
console.log(busAny.listenerCount("a", handler), busAny.listenerCount("a", other), busAny.listenerCount("b", handler));

fire(bus, "a", "s");
busAny.off("a", ls[0]);
console.log(busAny.listenerCount("a"), busAny.listeners("a")[0] === other);
fire(bus, "a", "t");
const snap = busAny.listeners("b");
busAny.removeAllListeners("b");
snap.forEach((f: any) => f(5));
console.log(snap[0] === handler);
const e2 = new EventEmitter();
const typedOnce = (s: string) => console.log("once", typeof s, s);
e2.once("o", typedOnce);
console.log(e2.listeners("o")[0] === typedOnce, (e2 as any).listeners("o")[0] === typedOnce);
fire(e2, "o", 4);
console.log(e2.listenerCount("o"));
