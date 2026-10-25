// Two top-level writes of the same prototype datum: the last one wins for every instance.
class W2 {
  constructor() { this.w = 1; }
  own() { this.lab3 = 'mine'; }
}
W2.prototype.lab3 = 'first';
W2.prototype.lab3 = 'second';
const w = new W2();
console.log(w.lab3);
w.own();
const w2 = new W2();
console.log(w.lab3, w2.lab3);
