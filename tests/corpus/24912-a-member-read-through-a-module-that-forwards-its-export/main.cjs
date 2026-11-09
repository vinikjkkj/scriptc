// Members of a module whose export is forwarded to another module's run-time value: every read is a property read of that value, whether or not the
// name is one the static export list knows. `default` is the one tsc-compiled callers read.
const debug_1 = require("./index.cjs");
function gen(namespace) {
  const fn = (0, debug_1.default)(`x:${namespace}`);
  return fn;
}
console.log(gen("q"), debug_1.tag, typeof debug_1.load, debug_1.debug === debug_1.default, debug_1.default("z"));
const load = debug_1.load;
console.log(typeof load, load());
