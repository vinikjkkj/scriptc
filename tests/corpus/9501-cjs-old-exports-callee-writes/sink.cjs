function wrap(env) {
  return { size: Object.keys(env).length, first: env.first + env.kept.length };
}
module.exports = wrap;
