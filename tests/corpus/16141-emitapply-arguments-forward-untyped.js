// emit.apply(this, arguments) forwards the whole call to untyped listeners, once and persistent.
const EventEmitter = require("events");
class Relay extends EventEmitter {
  forward() {
    return this.emit.apply(this, arguments);
  }
}
const r = new Relay();
r.once("tick", (n, label) => console.log("once", n, label));
r.on("tick", (n, label) => console.log("on", n, label));
console.log(r.forward("tick", 1, "a"));
console.log(r.forward("tick", 2, "b"));
console.log(r.listenerCount("tick"));
