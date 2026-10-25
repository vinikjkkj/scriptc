// A numeric prototype datum reads as a number and joins arithmetic.
class Counter {
  /** @param {number} k */
  constructor(k) { this.k = k; }
  inc() { this.step = 10; }
}
Counter.prototype.step = 1;
const c = new Counter(0);
const d = new Counter(0);
d.inc();
console.log(c.step + c.k, /** @type {number} */ (d.step) * 2, /** @type {number} */ (c.step), /** @type {number} */ (d.step));
Counter.prototype.step = 3;
console.log(c.step + 4, d.step);
