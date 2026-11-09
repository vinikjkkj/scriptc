function setup(env) {
  function createDebug(ns) {
    return "dbg:" + ns;
  }
  Object.keys(env).forEach((k) => {
    createDebug[k] = env[k];
  });
  return createDebug;
}
module.exports = setup;
