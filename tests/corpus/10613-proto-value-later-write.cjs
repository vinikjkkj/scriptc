// A later prototype write is seen by every instance that has no own value.
class Lvl {
  constructor(n) { this.n = n; }
  bump() { this.lvl = 'own'; }
}
Lvl.prototype.lvl = 'one';
const x = new Lvl(1);
const y = new Lvl(2);
y.bump();
console.log(x.lvl, y.lvl);
Lvl.prototype.lvl = 'two';
console.log(x.lvl, y.lvl, Lvl.prototype.lvl);
