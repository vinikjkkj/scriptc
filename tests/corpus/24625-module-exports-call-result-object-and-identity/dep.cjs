// The replacement is a plain object a factory built. Before the replacement the two names are one object; after it they are not.
const same0 = module.exports === exports;
exports.before = "kept on the original";
module.exports = require("./make.cjs")(7, exports);
const same1 = module.exports === exports;
module.exports.same0 = same0;
module.exports.same1 = same1;
exports.after = "also on the original";
module.exports.tick = function () { return module.exports.bump() * 10; };
