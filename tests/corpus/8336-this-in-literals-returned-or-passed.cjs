function makeCounter(start) {
  return { n: start, inc() { this.n++; return this.n; } };
}
const c = makeCounter(5);
console.log(c.inc(), c.inc());
function use2(o) { return o.inc() + o.inc(); }
console.log(use2({ n: 1, inc() { return this.n++; } }));
let late = { k: 2, dbl() { return this.k * 2; } };
console.log(late.dbl());
const wrap = { inner: { z: 4, getZ() { return this.z; } } };
console.log(wrap.inner.getZ());
