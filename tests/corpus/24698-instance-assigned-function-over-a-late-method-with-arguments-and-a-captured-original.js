// ioredis transaction.js: `pipeline.exec = function` over a LATE method (`Pipeline.prototype.exec`, which reads `arguments`) of a class
// that also gets run-time prototype members; the override calls the captured original with `exec.call(pipeline)`.
class Commander { constructor() { this.tag = "base"; } }
["multi", "get"].forEach(function (name) {
  Commander.prototype[name] = function () { return "table-" + name; };
});
class Pipeline extends Commander {
  constructor(redis) { super(); this.redis = redis; this.n = 0; }
  add(x) { this.n += x; return this; }
}
Pipeline.prototype.exec = function (callback) {
  return "raw-exec:" + this.n + ":" + (callback === undefined ? "-" : callback) + ":" + arguments.length;
};
function make(redis) {
  const pipeline = new Pipeline(redis);
  pipeline.add(2);
  const exec = pipeline.exec;
  pipeline.exec = function (callback) {
    if (callback === "boom") throw new Error("boom:" + this.n);
    return "wrapped[" + exec.call(pipeline) + "]" + (callback === undefined ? "" : callback);
  };
  return pipeline;
}
const p = make("r");
console.log(p.exec(), p.exec("cb"), p.add(1).exec());
try { p.exec("boom"); } catch (e) { console.log(e.message); }
const q = new Pipeline("z");
console.log(q.exec("q"), q.get(), p.exec("again"));
