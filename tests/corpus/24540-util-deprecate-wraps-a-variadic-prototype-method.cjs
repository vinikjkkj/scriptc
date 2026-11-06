// util.deprecate over a function that reads `arguments` and `this` (ioredis Pipeline#execBuffer, compiled CJS form `(0, util_1.deprecate)`):
// the wrapper warns once on stderr, forwards the receiver and every argument, and answers the function's result.
const util_1 = require("util");
function execImpl(a, b) { return "exec:" + a + "," + b; }
class P { constructor() { this.t = 2; } }
P.prototype.exec = execImpl;
const execBuffer = P.prototype.exec;
P.prototype.execBuffer = (0, util_1.deprecate)(function () {
  if (this.t > 0) { this.t -= 1; }
  return execBuffer.apply(this, arguments);
}, "P#execBuffer: Use P#exec instead");
const p = new P(), q = new P();
console.log(p.execBuffer("a", "b"), p.t);
console.log(p.execBuffer("c"), p.t, q.execBuffer("x", "y"), q.t);
