import EE = require("events");

function make(): EE {
  const e: EE = new EE();
  e.on("x", (s: string) => console.log("x", s));
  return e;
}
const m = make();
m.emit("x", "hello");
console.log(m instanceof EE);
