// A late method that reads `arguments` is a value too: `const exec = p.exec` keeps its arity-agnostic form and `exec.call(p, ...)` runs it
// with the receiver the call names, with every argument the call passes.
class Pipeline {
  constructor(tag) { this.tag = tag; this.n = 0; }
  add(x) { this.n += x; return this; }
}
Pipeline.prototype.exec = function (callback) {
  return "exec:" + this.tag + ":" + this.n + ":" + (callback === undefined ? "-" : callback) + ":" + arguments.length;
};
const p = new Pipeline("p").add(2);
const q = new Pipeline("q").add(5);
const exec = p.exec;
console.log(exec.call(p), exec.call(q, "cb"), exec.call(q, "a", "b", "c"));
console.log(p.exec("direct"), q.exec());
const again = q.exec;
console.log(again === exec, typeof exec);
