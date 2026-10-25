// One event name ('tick') emitted with an Error at one site, a string at
// another and an unknown at a third, with a listener registered BEFORE the
// emits. The listener's parameter is unknown, so the event is dyn-listened:
// every payload boxes, and the listener reads each one through typeof and
// instanceof narrowing, the value printed beside its type.
import { EventEmitter } from "node:events";

class Source extends EventEmitter {
  fail(): void {
    this.emit("tick", new Error("boom"));
  }
  text(): void {
    this.emit("tick", "plain text");
  }
  any(value: unknown): void {
    this.emit("tick", value);
  }
}

const src = new Source();
src.on("tick", (x: unknown) => {
  if (x instanceof Error) {
    console.log("error", x.message);
  } else {
    console.log("typeof", typeof x, String(x));
  }
});
src.fail();
src.text();
src.any(42);
src.any({ a: 1 });
src.any(undefined);
src.any(null);
console.log("end", src.listenerCount("tick"));
