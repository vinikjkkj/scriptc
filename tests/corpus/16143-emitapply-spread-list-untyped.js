// emit.apply(this, list) with a rest-built list reaching an untyped error-free listener, plus removal.
const EventEmitter = require("events");
class Pipe extends EventEmitter {
  push(...items) {
    return this.emit.apply(this, items);
  }
}
const p = new Pipe();
const seen = (x, y) => console.log("seen", x, y);
p.on("row", seen);
console.log(p.push("row", "x", 2));
p.removeListener("row", seen);
console.log(p.push("row", "x", 3));
console.log(p.listenerCount("row"));
