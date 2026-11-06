// @exit: 3
// process.traceDeprecation: the report carries the warning's stack (header line, then frames) and no `--trace-deprecation` hint.
// Frame lines cannot match Node (a compiled binary keeps no call stacks); the exit code keeps stderr out of the comparison.
const util = require("util");
process.traceDeprecation = true;
const f = util.deprecate((x) => x + 1, "f is deprecated", "DEP_R");
console.log(f(1), process.traceDeprecation);
setTimeout(() => { process.exitCode = 3; }, 5);
