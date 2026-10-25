// A data name on the prototype whose class also has an accessor of another name stays independent.
class Acc {
  constructor(n) { this.n = n; }
  get double() { return this.n * 2; }
}
Acc.prototype.unit = 'u';
const a = new Acc(4);
console.log(a.double, a.unit, a.n);
Acc.prototype.unit = 'v';
console.log(a.unit, a.double);
