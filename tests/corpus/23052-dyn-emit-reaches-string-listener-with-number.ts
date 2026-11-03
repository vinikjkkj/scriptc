/* eslint-disable @typescript-eslint/no-explicit-any, prefer-spread -- dynamic emits reach typed listeners on purpose */
import { EventEmitter } from "events";
const bus = new EventEmitter();
bus.on("str", (s: string) => {
  try {
    console.log("str", typeof s, s + 1, `${s}!`, s.length, s.toUpperCase(), s === "ab", s < "b");
  } catch (e) {
    console.log("str threw", (e as Error).constructor.name, (e as Error).message);
  }
});
function fire(x: any, name: string, ...args: unknown[]) { return x.emit(name, ...args); }
bus.emit("str", "ab");
for (const v of [5, undefined, null, {}, "ab", true, [3]]) fire(bus, "str", v);
bus.emit("str", "zz");
