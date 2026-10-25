// The same instance reads an undefined name and a value name in one statement, then writes both.
class Both {
  constructor(i) { this.i = i; }
  setU(u) { this.uu = 'u' + u; }
}
Both.prototype.uu = undefined;
Both.prototype.vv = 'vv0';
const b = new Both(1);
console.log(b.uu, b.vv, b.uu === undefined && b.vv === 'vv0');
b.setU(9);
console.log(b.uu, b.vv);
