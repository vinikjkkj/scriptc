const utils = require("./lib/utils");
const lodash = require("./lib/lodash");

console.log(utils.zipPairs(["a", "b"], [1, 2]).join("&"));
console.log(JSON.stringify(utils.defaults({ a: 1 }, { a: 2, b: 3 })));
console.log(typeof utils.noop, utils.noop());
console.log(utils.isArguments([1]), lodash.isArguments([2]));
console.log(lodash.defaults === utils.defaults, lodash.noop === utils.noop);
console.log(JSON.stringify(lodash.defaults({}, { z: 26 })));
