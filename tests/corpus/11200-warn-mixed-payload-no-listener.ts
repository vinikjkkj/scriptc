// The mysql2 'warn' shape, reduced: one event name emitted from a base
// emitter class and from a subclass with an Error, an unknown, a TypeError
// and no listener anywhere. No typed listener reads the position, so the
// sites agree on one dyn position (an Error or a TypeError boxes into it),
// and nothing declared is handed a value it does not admit. emit() returns
// false with no listener. 'progress' is emitted with 0, 1 and 2 arguments,
// so the arity differs across sites too.
import { EventEmitter } from "node:events";

class Base extends EventEmitter {
  handlePacket(seq: number, want: number): void {
    if (seq !== want) {
      const err = new Error(`out of order ${seq}`);
      this.emit("warn", err);
    }
  }
}

class Pooled extends Base {
  release(cause: unknown): void {
    console.log("release delivered", this.emit("warn", cause));
  }
  end(): void {
    const e = new TypeError("end is deprecated");
    console.log("end delivered", this.emit("warn", e));
  }
  note(): void {
    this.emit("progress");
    this.emit("progress", 1);
    this.emit("progress", 1, "two");
  }
}

const p = new Pooled();
p.handlePacket(1, 2);
p.release("released");
p.release(undefined);
p.end();
p.note();
console.log("warn listeners", p.listenerCount("warn"), "progress listeners", p.listenerCount("progress"));
