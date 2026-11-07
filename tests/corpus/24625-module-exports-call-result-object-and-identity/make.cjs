module.exports = function make(seed, env) {
  const table = { seed, count: 0 };
  table.bump = function () { table.count += 1; return table.count; };
  table.env = env;
  return table;
};
