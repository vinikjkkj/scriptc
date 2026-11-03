/* eslint-disable @typescript-eslint/no-explicit-any, prefer-spread -- dynamic emits reach typed listeners on purpose */
import { EventEmitter } from "events";
function fire(x: any, name: string, ...args: unknown[]) { return x.emit(name, ...args); }
const e3 = new EventEmitter();
e3.on("d", ({ a, b }: { a: number; b: string }) => console.log("d", typeof a, a, typeof b, b));
fire(e3, "d", { a: "1", b: 2 });
e3.on("fn", function (n: number) { console.log("fn", typeof n, n); });
fire(e3, "fn", "s");
e3.emit("fn", 4);
e3.on("as", async (n: number) => { await null; console.log("as", typeof n, n); });
fire(e3, "as", "w");
e3.on("opt", (n?: number) => console.log("opt", typeof n, n));
fire(e3, "opt");
fire(e3, "opt", "o");
