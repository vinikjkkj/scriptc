// A string method on a prototype datum; the datum is a value, not a method.
class Tok {
  /** @param {string} s */
  constructor(s) { this.s = s; }
  setPre() { this.pre = 'qq'; }
}
Tok.prototype.pre = 'pp';
const t = new Tok('abc');
console.log(/** @type {string} */ (t.pre).toUpperCase(), t.s.indexOf('b'));
t.setPre();
const z = new Tok('z');
console.log(/** @type {string} */ (t.pre).toUpperCase(), z.pre);
