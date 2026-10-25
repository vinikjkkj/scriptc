// instanceof on instances of two classes, and the prototype datum read on each branch.
class Ax {
  constructor() { this.ka = 1; }
}
class Bx {
  constructor() { this.kb = 2; }
}
Ax.prototype.shared = 'ax';
Bx.prototype.shared = 'bx';
const a1 = new Ax();
const b1 = new Bx();
console.log(a1 instanceof Ax ? 'A' : 'B', a1.shared);
console.log(b1 instanceof Ax ? 'A' : 'B', b1.shared);
