var merge = require("./merge.cjs");
var parts = [require("./part1.cjs"), require("./part2.cjs")];
for (var i = 0; i < parts.length; i++) merge(exports, parts[i]);
