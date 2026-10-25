// Control for the widening rule: one event name whose emit sites all pass an
// Error, read by a TYPED listener (err: Error). The listener pins the tuple
// and every site agrees with it, so nothing widens; the program compiles and
// prints as it did before the widening rule existed.
import { EventEmitter } from "node:events";

class Port extends EventEmitter {
  open(): void {
    this.emit("issue", new Error("first"));
  }
}

class Pool extends Port {
  close(): void {
    this.emit("issue", new Error("second"));
  }
}

const pool = new Pool();
pool.on("issue", (err: Error) => console.log("issue", err.name, err.message));
pool.open();
pool.close();
console.log("count", pool.listenerCount("issue"));
