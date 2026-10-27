import { EventEmitter } from "events";
class X extends EventEmitter {
  tag = "x";
  fwdEmit(name: any, v: any): any {
    const t: any = this;
    return t.emit(name, v);
  }
}
const x = new X();
x.on("a", (v: number) => console.log("typed got", v));
x.fwdEmit("a", 5);
x.fwdEmit("zz", 6);
const y: any = new X();
y.emit("a", 6);
