// A function of the module reads members the module attached to `exports` before it replaced its export: by the time it runs they are there.
exports.init = init;
exports.useColors = function useColors() {
  return true;
};
exports.opts = { a: 1, b: 2 };
function init(target) {
  const keys = Object.keys(exports.opts);
  target.copied = keys.join(",");
  return typeof exports.useColors + ":" + keys.length + ":" + exports.opts.b;
}
module.exports = require("./common.cjs")(exports);
