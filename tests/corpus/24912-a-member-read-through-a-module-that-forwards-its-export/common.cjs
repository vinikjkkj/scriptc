function setup(env) {
  function createDebug(ns) {
    return "dbg:" + ns;
  }
  createDebug.debug = createDebug;
  createDebug.default = createDebug;
  Object.keys(env).forEach((k) => {
    createDebug[k] = env[k];
  });
  return createDebug;
}
module.exports = setup;
