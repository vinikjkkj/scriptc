/* eslint-disable @typescript-eslint/no-explicit-any, prefer-spread -- dynamic emits reach typed listeners on purpose */
import { EventEmitter } from "events";
function fire(x: any, name: string, ...args: unknown[]) { return x.emit(name, ...args); }
class Svc extends EventEmitter {
  label = "svc";
  constructor() {
    super();
    this.on("add", (n: number) => console.log("add", this.label, typeof n, n, this.label + n));
    this.once("once", (s: string) => console.log("once", typeof s, s));
    this.prependListener("add", (n: number) => console.log("pre", typeof n, n));
    this.addListener("add", (n: number) => console.log("post", typeof n, n * 2));
  }
}
const svc = new Svc();
console.log(svc.emit("add", 2), svc.emit("once", "o"), svc.emit("once", "again"));
fire(svc, "add", "3");
fire(svc, "add", undefined);
fire(svc, "once", 5);
fire(svc, "once", 6);
console.log(svc.listenerCount("add"), svc.listenerCount("once"));
