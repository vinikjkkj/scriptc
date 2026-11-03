/* eslint-disable @typescript-eslint/no-explicit-any, prefer-spread -- dynamic emits reach typed listeners on purpose */
import { EventEmitter } from "events";
const bus = new EventEmitter();
const sink: Array<() => unknown> = [];
bus.on("clo", (n: number) => {
  sink.push(() => n + 1);
  sink.push(() => typeof n);
  sink.push(() => String(n) + (n * 2));
  const inner = (k: number) => n + k;
  sink.push(() => inner(1));
});
function fire(x: any, name: string, ...args: unknown[]) { return x.emit(name, ...args); }
bus.emit("clo", 1);
fire(bus, "clo", "7");
fire(bus, "clo", undefined);
console.log(sink.map((f) => f()));
