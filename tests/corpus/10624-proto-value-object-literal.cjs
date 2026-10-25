// A prototype datum of an object literal is shared by every instance (identity holds).
class Shared {
  constructor(n) { this.n = n; }
}
Shared.prototype.opts = { depth: 2 };
const s1 = new Shared(1);
const s2 = new Shared(2);
console.log(s1.opts === s2.opts, s1.opts.depth, s2.opts.depth);
Shared.prototype.opts.depth = 5;
console.log(s1.opts.depth, s2.opts.depth);
