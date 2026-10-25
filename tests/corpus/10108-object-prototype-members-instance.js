// Object.prototype members read by literal key on a class instance: function values, callable with the receiver.
class Pt {
  constructor() { this.x = 1; this.y = 'b'; }
  m() { return 5; }
}
const p = new Pt();
console.log(typeof p['toString'], typeof p['constructor'], typeof p['valueOf'], typeof p['hasOwnProperty'], typeof p['isPrototypeOf'], typeof p['propertyIsEnumerable'], typeof p['toLocaleString']);
console.log(p['toString'].call(p), p['toLocaleString'].call(p));
console.log(p['hasOwnProperty'].call(p, 'x'), p['hasOwnProperty'].call(p, 'm'), p['propertyIsEnumerable'].call(p, 'y'));
console.log(p['isPrototypeOf'].call(p, p));
