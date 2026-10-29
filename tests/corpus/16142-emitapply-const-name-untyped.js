// emit.apply where the listener is registered under a const-bound name and takes one untyped parameter.
const EventEmitter = require("events");
class Bus extends EventEmitter {
  fire() {
    return this.emit.apply(this, arguments);
  }
}
const bus = new Bus();
const name = "z";
bus.on(name, (a) => console.log("const-name", a));
console.log(bus.fire("z", 7));
console.log(bus.fire("y", 8));
