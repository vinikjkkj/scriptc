// The || default over a prototype datum: an own falsy value is answered by the own value, not the prototype.
class Dflt {
  constructor(n) { this.n = n; }
  zero() { this.zz = 0; }
}
Dflt.prototype.zz = 7;
const d = new Dflt(1);
console.log(d.zz || 'fallback', d.zz);
d.zero();
console.log(d.zz || 'fallback', d.zz, d.zz ?? 'nullish');
