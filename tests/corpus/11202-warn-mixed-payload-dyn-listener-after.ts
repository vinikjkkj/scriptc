// The same mixed payloads on one event name, but the 'tick' emits happen
// BEFORE the listener is registered. Node delivers nothing to a listener that
// does not exist yet (emit returns false), then the later payloads reach the
// listener, which reads them as unknown. The listener is the one registered
// last in the source, so the ordering rule is observable in the output.
import { EventEmitter } from "node:events";

class Bus extends EventEmitter {}

const bus = new Bus();
console.log("early", bus.emit("tick", new Error("early")));
console.log("early", bus.emit("tick", "middle"));
bus.on("tick", (x: unknown) => console.log("late", typeof x, String(x)));
console.log("late emit", bus.emit("tick", 7));
bus.emit("tick", new RangeError("r"));
bus.emit("tick", undefined);
console.log("count", bus.listenerCount("tick"));
