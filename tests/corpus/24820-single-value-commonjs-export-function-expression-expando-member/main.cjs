const calculateSlot = require("./ck.cjs");
const keys = ["a", "a"];
console.log(calculateSlot("x"), calculateSlot.generateMulti(keys), calculateSlot.generateMulti(["a", "b"]));
