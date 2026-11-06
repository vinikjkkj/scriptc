// A wrapper warns once; a code is shared across wrappers (the second wrapper under a used code stays silent); no code, no sharing.
const util = require("util");
const add = util.deprecate((a, b) => a + b, "add is deprecated", "DEP_X");
const mul = util.deprecate((a, b) => a * b, "mul is deprecated", "DEP_X");
const neg = util.deprecate((a) => -a, "neg is deprecated");
const neg2 = util.deprecate((a) => -a, "neg is deprecated");
const hello = util.deprecate(function (s) { return "hello " + s + this; }, "hello is deprecated", "DEP_H");
console.log(add(1, 2), add(3, 4), mul(2, 3), mul(4, 5));
console.log(neg(1), neg(2), neg2(3), neg2(4));
console.log(hello.call("!", "w"), hello.call("?", "v"));
console.log(typeof add, add.length, mul.length);
