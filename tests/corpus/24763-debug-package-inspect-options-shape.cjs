// The debug package's node.js shape: inspectOpts built from the environment, formatWithOptions(exports.inspectOpts, ...args), util.inspect(v, this.inspectOpts).
const util = require("util");
process.env.DEBUG_DEPTH = "1";
process.env.DEBUG_SHOW_HIDDEN = "no";
exports.inspectOpts = Object.keys(process.env).filter((key) => /^debug_/i.test(key)).reduce((obj, key) => {
  const prop = key.substring(6).toLowerCase().replace(/_([a-z])/g, (_, k) => k.toUpperCase());
  let val = process.env[key];
  if (/^(yes|on|true|enabled)$/i.test(val)) val = true;
  else if (/^(no|off|false|disabled)$/i.test(val)) val = false;
  else if (val === "null") val = null;
  else val = Number(val);
  obj[prop] = val;
  return obj;
}, {});
function log(...args) {
  return process.stdout.write(util.formatWithOptions(exports.inspectOpts, ...args) + "\n");
}
const formatters = {};
formatters.o = function (v) {
  this.inspectOpts.colors = this.useColors;
  return util.inspect(v, this.inspectOpts).split("\n").map((str) => str.trim()).join(" ");
};
formatters.O = function (v) {
  this.inspectOpts.colors = this.useColors;
  return util.inspect(v, this.inspectOpts);
};
function createDebug(useColors) {
  const debug = function () {};
  debug.useColors = useColors;
  debug.inspectOpts = {};
  const keys = Object.keys(exports.inspectOpts);
  for (let i = 0; i < keys.length; i++) debug.inspectOpts[keys[i]] = exports.inspectOpts[keys[i]];
  debug.formatters = formatters;
  return debug;
}
log("%s=%d", "a", 5, { deep: { x: { y: 1 } } });
for (const c of [false, true]) {
  const d = createDebug(c);
  console.log(JSON.stringify(d.formatters.o.call(d, { a: [1, { b: { c: 1 } }], s: "str" })));
  console.log(JSON.stringify(d.formatters.O.call(d, { a: 1, b: "x" })));
}
