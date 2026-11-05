"use strict";
// A JavaScript field that holds a value and is later cleared with `null` (mysql2: `this.connectTimeout = null` after clearTimeout).
// The checker drops null from the inferred type; Node holds it, and `=== null`, printing and later re-assignment all see it.
class Conn {
  constructor(cfg) {
    this.cfg = cfg;
    this.log = [];
    this.count = 5;
    this.opts = { depth: 1 };
    if (cfg.timeout) {
      this.timer = setTimeout(() => { this.log.push("timeout"); }, cfg.timeout);
    }
  }
  done() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.count = null;
    this.opts = null;
    this.log.push("done:" + (this.timer === null) + ":" + (this.count === null) + ":" + (this.opts === null));
  }
  again(n) {
    this.count = n;
    this.opts = { depth: n };
    return this.count + this.opts.depth;
  }
}
const a = new Conn({ timeout: 1000 });
const b = new Conn({});
console.log(a.count, a.opts, a.timer !== undefined, b.timer !== undefined);
a.done();
b.done();
console.log(a.log.join(","), b.log.join(","));
console.log(a.timer, b.timer, a.count, a.opts, b.count);
console.log(a.again(3), a.count, a.opts);
