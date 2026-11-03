/* eslint-disable @typescript-eslint/no-explicit-any, prefer-spread -- dynamic emits reach typed listeners on purpose */
import { EventEmitter } from "events";
// Typed listeners capture their own emitter: the typed body and its erased twin each close over it. Dropping every
// reference must free the ring (the registry traces both closures), and the dynamic emit must still reach the twin.
function fire(x: any, name: string, ...args: unknown[]) { return x.emit(name, ...args); }
class Node2 extends EventEmitter {
  hits = 0;
  constructor() {
    super();
    this.on("tick", (n: number) => { this.hits++; console.log("tick", typeof n, n, this.listenerCount("tick")); });
  }
}
function make(i: number): number {
  const b = new EventEmitter();
  b.on("x", (n: number) => console.log("x", i, typeof n, n, b.listenerCount("x")));
  b.once("y", (s: string) => console.log("y", i, typeof s, s, b.eventNames().length));
  fire(b, "x", "s" + i);
  fire(b, "y", i);
  b.emit("x", i);
  return b.listenerCount("x");
}
for (let i = 0; i < 3; i++) console.log(make(i));
const n2 = new Node2();
fire(n2, "tick", "t");
n2.emit("tick", 1);
console.log(n2.hits);
