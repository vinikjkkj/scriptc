// A JavaScript class saves its own prototype method in a constant, replaces it, and the replacement applies the saved original (ioredis' Pipeline.multi).
class Pipeline {
  constructor() { this._transactions = 0; this.log = []; }
  multi() { this.log.push("multi"); return this; }
}
const multi = Pipeline.prototype.multi;
Pipeline.prototype.multi = function () {
  this._transactions += 1;
  return multi.apply(this, arguments);
};
const p = new Pipeline();
p.multi().multi();
console.log(p._transactions, p.log.join(","));
console.log(typeof multi, multi === Pipeline.prototype.multi);
