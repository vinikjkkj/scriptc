// process.noDeprecation: true when the wrapper is MADE returns the very function (no wrapper); set later, the wrapper stays and
// reports nothing, yet a code it would have warned under counts as warned.
const util = require("util");
const orig = (x) => x + 1;
const early = util.deprecate(orig, "early", "DEP_E");
console.log(process.noDeprecation);
process.noDeprecation = true;
const same = util.deprecate(orig, "never warns");
console.log(same === orig, process.noDeprecation, same(1));
process.noDeprecation = false;
const wrapped = util.deprecate(orig, "late", "DEP_L");
process.noDeprecation = true;
console.log(wrapped(1), early(1));
process.noDeprecation = undefined;
const again = util.deprecate((x) => x * 2, "again", "DEP_L");
console.log(again(2), early(5), wrapped === orig, again === orig);
