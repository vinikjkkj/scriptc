// The prototype DATA form of the same wrapper: `C.prototype.m = util.deprecate(function () { ... orig.apply(this, arguments) }, msg)` after
// `const orig = C.prototype.m` read above it, over an inherited run-time table member (ioredis Pipeline#execBuffer).
process.noDeprecation = true;
const util = require("util");
class Commander { constructor() { this.tag = "c"; } }
["get", "execBuffer"].forEach(function (name) {
  Commander.prototype[name] = function (...args) { return name + ":" + args.join("|") + ":" + this.tag; };
});
class Pipeline extends Commander { constructor() { super(); this._transactions = 2; } }
const execBuffer = Pipeline.prototype.execBuffer;
Pipeline.prototype.execBuffer = util.deprecate(function () {
  if (this._transactions > 0) {
    this._transactions -= 1;
  }
  return execBuffer.apply(this, arguments);
}, "Pipeline#execBuffer: Use Pipeline#exec instead");
const p = new Pipeline();
console.log(p.execBuffer("k"), p._transactions, p.get("a"));
