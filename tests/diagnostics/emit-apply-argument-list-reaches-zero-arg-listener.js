const EventEmitter = require("events");
class C extends EventEmitter {
  silent(eventName, arg) {
    if (this.listeners("ready").length > 0) {
      return this.emit.apply(this, arguments);
    }
    return false;
  }
}
const c = new C();
c.on("ready", () => console.log("ready!"));
console.log(c.silent("ready", 1));
