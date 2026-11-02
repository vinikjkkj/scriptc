const EventEmitter = require("events");
class C extends EventEmitter {
  fwd() { return this.emit.apply(this, arguments); }
}
const c = new C();
c.on("error", () => console.log("err zero"));
console.log(c.fwd("error", 5));
