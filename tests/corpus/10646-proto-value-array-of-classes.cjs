// Prototype data on a class used through an array of its instances and a reduce over the datum.
class Sz {
  constructor(n) { this.n = n; }
  setW() { this.w = 5; }
}
Sz.prototype.w = 1;
const szs = [new Sz(1), new Sz(2), new Sz(3)];
szs[1].setW();
console.log(szs.reduce((acc, s) => acc + /** @type {number} */ (s.w), 0));
