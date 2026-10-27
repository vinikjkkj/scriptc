import { EventEmitter } from "events";
class X extends EventEmitter {
  tag = "x";
}
const x: any = new X();
x.on("a", (v: number) => console.log("typed got", v));
x.on("a", (v: any) => console.log("dyn got", v));
x.emit("a", 5);
x.emit("b", 1);
console.log(x.listenerCount("a"));
console.log(x.listenerCount("b"));
x.on("b", (v: number) => console.log("b got", v));
x.emit("b", 2);
