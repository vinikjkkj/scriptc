// A factory: the function it returns carries members the compiler cannot see (the debug package's createDebug).
module.exports = function setup(env) {
  function create(ns) {
    function debug(...args) { return ns + ":" + args.join(","); }
    debug.namespace = ns;
    return debug;
  }
  create.formatters = {};
  create.humanize = (n) => n + "ms";
  create.env = env;
  return create;
};
