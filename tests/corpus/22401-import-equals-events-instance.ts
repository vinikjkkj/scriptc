import EE = require("events");

const e = new EE();
let total = 0;
e.on("add", (v: number) => {
  total += v;
});
e.once("add", (v: number) => console.log("once", v));
e.emit("add", 3);
e.emit("add", 4);
console.log("total", total, e.listenerCount("add"));
