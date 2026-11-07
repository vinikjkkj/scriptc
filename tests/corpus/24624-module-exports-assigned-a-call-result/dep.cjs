// The whole export is a CALL's result. `exports` stays the ORIGINAL object (the factory received it and keeps it); `module.exports`
// becomes the returned function; functions written before the replacement read each through its own name afterwards.
exports.colors = [1, 2];
exports.tag = "dep";
function colorsLater() { return exports.colors.length; }
function human(n) { return module.exports.humanize(n); }
module.exports = require("./setup.cjs")(exports);
const { formatters } = module.exports;
formatters.o = function (v) { return "o<" + v + ">"; };
formatters.x = function (v) { return "x<" + v + ">"; };
exports.colorsLater = colorsLater;
module.exports.human = human;
