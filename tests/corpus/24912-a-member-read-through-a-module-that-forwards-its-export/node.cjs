exports.tag = "T";
exports.load = function load() {
  return "L";
};
module.exports = require("./common.cjs")(exports);
