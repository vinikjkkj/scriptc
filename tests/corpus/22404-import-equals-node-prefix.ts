import EE = require("node:events");

class Ticker extends EE {}
const t = new Ticker();
t.on("go", () => console.log("go"));
t.emit("go");
console.log(t.listenerCount("go"));
