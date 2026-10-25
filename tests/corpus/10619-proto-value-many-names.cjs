// Several non-undefined data names on one class, read in one expression.
class Rec {
  constructor(id) { this.id = id; }
  setA() { this.fa = 'own'; }
}
Rec.prototype.fa = 'fa0';
Rec.prototype.fb = 'fb0';
Rec.prototype.fc = 0;
const r = new Rec(1);
console.log(r.fa + r.fb + r.fc, r.fb.length, r.fc + 5);
r.setA();
console.log(r.fa, r.fb, r.fc);
