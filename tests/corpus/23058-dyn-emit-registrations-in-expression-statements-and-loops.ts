/* eslint-disable @typescript-eslint/no-explicit-any, prefer-spread -- dynamic emits reach typed listeners on purpose */
import { EventEmitter } from "events";
function fire(x: any, name: string, ...args: unknown[]) { return x.emit(name, ...args); }
const es = [new EventEmitter(), new EventEmitter()];
es.forEach((e, i) => e.on("ev", (n: number) => console.log("fe", i, typeof n, n)));
for (const e of es) fire(e, "ev", "q");
es[0]!.emit("ev", 1);
if (es.length > 1) es[1]!.on("cond", (b: boolean) => console.log("cond", typeof b, b));
else es[0]!.on("cond", (b: boolean) => console.log("cond0", b));
fire(es[1], "cond", "yes");
for (let i = 0; i < 2; i++) es[0]!.on("lp", (n: number) => console.log("lp", i, typeof n, n));
fire(es[0], "lp", "z");
const reg = (e: EventEmitter, k: number) => e.on("arrowbody", (n: number) => console.log("ab", k, typeof n, n + k));
reg(es[0]!, 10);
fire(es[0], "arrowbody", "s");
switch (es.length) {
  case 2:
    es[1]!.on("sw", (n: number) => console.log("sw", typeof n, n));
    break;
  default:
    break;
}
fire(es[1], "sw", null);
