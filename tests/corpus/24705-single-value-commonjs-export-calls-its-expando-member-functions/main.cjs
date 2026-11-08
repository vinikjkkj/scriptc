// Calling a member function of a single-value CommonJS export (`calculateSlot.generateMulti(keys)`): the member is the exporter's own function,
// with a typed parameter list and with an implicit-any one.
const calculateSlot = require("./ck.cjs");
const same = ["a", "a"];
console.log(calculateSlot("x"), calculateSlot.generateMulti(same), calculateSlot.generateMulti(["a", "b"]));
console.log(calculateSlot.describe({ n: 3 }, "d"), calculateSlot.describe({ n: 4 }, "e"));
