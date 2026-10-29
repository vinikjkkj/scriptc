// emit.apply with a runtime argument list reaching untyped (checked-dynamic) listeners.
const EventEmitter = require("events");
class Hub extends EventEmitter {
  relay(name, args) {
    return this.emit.apply(this, [name, ...args]);
  }
}
const hub = new Hub();
hub.on("data", (a, b) => console.log("data", a, b));
hub.on("data", function (a) { console.log("second", a, typeof a); });
console.log(hub.relay("data", [1, "y"]));
console.log(hub.relay("data", [{ k: 2 }]));
console.log(hub.relay("missing", [3]));
console.log(hub.listenerCount("data"));
