const EventEmitter = require("events");
class C extends EventEmitter {
  fwd() { return this.emit.apply(this, arguments); }
}
const c = new C();
c.on("newListener", () => console.log("nl zero"));
console.log(c.fwd("newListener", 5));
