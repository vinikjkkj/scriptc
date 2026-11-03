const { EventEmitter } = require("events");
const bus = new EventEmitter();
/** @param {number} n */
function onNum(n) { console.log("js", typeof n, n, n + 1); }
bus.on("a", onNum);
bus.on("b", /** @param {string} s */ (s) => console.log("js2", typeof s, s));
function fire(x, name, ...args) { return x.emit(name, ...args); }
bus.emit("a", 1);
bus.emit("b", "x");
fire(bus, "a", "s");
fire(bus, "b", 7);
