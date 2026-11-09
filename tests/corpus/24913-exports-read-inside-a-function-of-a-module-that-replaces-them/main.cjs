const dbg = require("./node.cjs");
const target = {};
console.log(dbg.init(target), target.copied, typeof dbg.useColors, dbg("n"));
