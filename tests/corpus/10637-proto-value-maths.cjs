// Math over prototype data of numbers, with a float and a negative value.
class Geo {
  /** @param {number} x */
  constructor(x) { this.x = x; }
  scale() { this.scaleK = 4; }
}
Geo.prototype.scaleK = 0.5;
Geo.prototype.offset = -3;
const g = new Geo(10);
console.log(/** @type {number} */ (g.x) * /** @type {number} */ (g.scaleK), g.offset + /** @type {number} */ (g.x), Math.abs(g.offset));
g.scale();
console.log(/** @type {number} */ (g.x) * /** @type {number} */ (g.scaleK), g.scaleK);
