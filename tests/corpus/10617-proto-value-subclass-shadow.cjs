// A subclass's own field of the same name is its own storage: the base's datum is not visible through it.
class Q0 {
  constructor() { this.x = 0; }
  setLab() { this.lab = 'qv'; }
}
Q0.prototype.lab = 'qbase';
class Q1 extends Q0 {
  constructor() { super(); this.lab2 = 'no'; }
  setLab2() { this.lab = 'q1own'; }
}
const q1 = new Q1();
console.log(q1.lab);
q1.setLab2();
const q0 = new Q0();
q0.setLab();
console.log(q0.lab, q1.lab);
