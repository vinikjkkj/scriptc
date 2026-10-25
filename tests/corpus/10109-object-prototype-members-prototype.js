// Object.prototype members read by literal key on a class prototype: the constructor is the class; own methods are own properties.
class Pt {
  constructor() { this.x = 1; this.n = 2; }
  m() { return 5; }
}
const p = new Pt();
console.log(typeof Pt.prototype['constructor'], typeof Pt.prototype['m'], typeof Pt.prototype['hasOwnProperty'], typeof Pt.prototype['propertyIsEnumerable']);
console.log(p['x'], p['m'].call(p), p['n']);
console.log(p['constructor'] === Pt);
