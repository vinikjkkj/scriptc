// process.throwDeprecation: the DeprecationWarning is thrown from a nextTick instead of reported (and no 'warning' event fires).
// The thrown warning reaches uncaughtException with its name, code and message; a call made while noDeprecation is true does not throw.
const util = require("util");
process.on("warning", (w) => console.log("warning event", w.name));
process.on("uncaughtException", (e) => console.log("uncaught", e.name, e.code, e.message));
process.throwDeprecation = true;
const f = util.deprecate((x) => x + 1, "f is deprecated", "DEP_T");
console.log(f(1), process.throwDeprecation);
console.log(f(2));
process.noDeprecation = true;
const g = util.deprecate((x) => x * 2, "g is deprecated");
console.log(g(4));
setTimeout(() => console.log("done"), 5);
