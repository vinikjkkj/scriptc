// A CommonJS module attaches members to `exports` and then replaces its export with the result of a function it hands `exports` to (the debug package's
// `module.exports = require("./common")(exports)`): the callee reads and copies the members the object holds at that moment, after the function declarations
// that precede the attachments in the source were hoisted.
function setup(env) {
  function createDebug(ns) {
    return ns + "!";
  }
  Object.keys(env).forEach((key) => {
    createDebug[key] = env[key];
  });
  createDebug.enable = function (v) {
    return "en:" + v;
  };
  console.log(Object.keys(env).join(","), typeof env.load, typeof createDebug.log);
  console.log(createDebug.enable(createDebug.load()), createDebug("x"));
  return createDebug;
}
exports.load = function load() {
  return "loaded";
};
exports.log = function log() {
  return 1;
};
exports.useColors = function useColors() {
  return true;
};
module.exports = setup(exports);
