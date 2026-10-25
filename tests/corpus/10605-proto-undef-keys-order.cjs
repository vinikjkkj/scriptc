// Object.keys lists a method-assigned datum only after its write, in write order.
class Pair {
  constructor(a) { this.a = a; }
  setB() { this.b = 'y'; }
  setC() { this.c = 'z'; }
}
Pair.prototype.b = undefined;
Pair.prototype.c = undefined;
const p = new Pair(1);
console.log(Object.keys(p));
p.setB();
p.setC();
console.log(Object.keys(p), p.b, p.c);
