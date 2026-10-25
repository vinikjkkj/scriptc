// A prototype datum read passed as an argument to another method of the same instance.
class Calc {
  constructor(b) { this.b = b; }
  add(x) { return x + this.base2; }
  setBase() { this.base2 = 7; }
}
Calc.prototype.base2 = 100;
const c = new Calc(1);
console.log(c.add(1), c.add(c.b));
c.setBase();
console.log(c.add(1), c.add(c.base2));
