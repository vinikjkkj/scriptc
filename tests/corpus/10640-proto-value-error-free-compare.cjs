// Comparisons between a prototype datum and a computed own value.
class Cmp {
  /** @param {number} a */
  constructor(a) { this.a = a; }
  setLimit() { this.limit = 50; }
}
Cmp.prototype.limit = 10;
const c1 = new Cmp(4);
const c2 = new Cmp(40);
console.log(c1.a < /** @type {number} */ (c1.limit), c2.a < /** @type {number} */ (c2.limit));
c2.setLimit();
console.log(c2.a < /** @type {number} */ (c2.limit), /** @type {number} */ (c2.limit) - /** @type {number} */ (c1.limit));
