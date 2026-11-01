import EventEmitter = require("events");

class Bus extends EventEmitter {
  fire(n: number): void {
    this.emit("tick", n);
  }
}

const bus = new Bus();
bus.on("tick", (n: number) => console.log("tick", n));
bus.fire(1);
bus.fire(2);
console.log(bus instanceof EventEmitter);
