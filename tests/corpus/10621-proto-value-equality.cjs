// Strict equality of two instances' prototype reads, and of a read with a literal.
class E1 {
  constructor() { this.e = 1; }
  setE() { this.esh = 'z2'; }
}
E1.prototype.esh = 'z';
const a = new E1();
const b = new E1();
console.log(a.esh === b.esh, a.esh === 'z', a.esh !== 'y');
b.setE();
console.log(a.esh === b.esh, b.esh);
