// A function with declared parameters that also reads `arguments` (a variadic signature with a pack behind them) and one with a
// rest parameter: the wrapper re-joins the declared arguments with the pack, forwards the receiver, and warns once.
const util = require("util");
const mixed = util.deprecate(function (a, b) {
  return [a, b, Array.prototype.slice.call(arguments).length, this === undefined ? "nothis" : this.tag].join("|");
}, "mixed is deprecated", "DEP_M");
const rest = util.deprecate(function (first, ...others) { return first + ":" + others.join(","); }, "rest is deprecated");
console.log(mixed(1, 2, 3, 4), mixed("x"));
console.log(mixed.call({ tag: "T" }, "p", "q", "r"));
console.log(rest("a", "b", "c"), rest("z"));
