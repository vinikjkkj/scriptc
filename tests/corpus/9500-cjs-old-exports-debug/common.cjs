function setup(env) {
  function createDebug(ns) {
    const d = { ns, n: env.colors.length, inited: false };
    if (typeof createDebug.init === 'function') createDebug.init(d);
    return d;
  }
  createDebug.log = env.log;
  createDebug.colors = env.colors;
  createDebug.inspectOpts = env.inspectOpts;
  createDebug.humanize = (x) => 'h' + x;
  createDebug.readLater = () => env.inspectOpts.hideDate;
  return createDebug;
}
module.exports = setup;
