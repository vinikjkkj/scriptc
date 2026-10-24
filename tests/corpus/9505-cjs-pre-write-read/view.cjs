module.exports = function view(env) {
  return { early: env.early, after: env.after, pre: env.pre };
};
