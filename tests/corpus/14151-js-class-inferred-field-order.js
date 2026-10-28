// A JS class's fields created by assignment (not declared in the class body) exist
// in the order each instance WROTE them, not the order the source spells them.
// Covers Object.keys, console.log, for-in, and a delete followed by a re-add (the key
// moves to the end, as in Node).
class Probe {
  constructor() { this.p = 1; }
  setB() { this.b = 'B'; }
  setA() { this.a = 'A'; }
}
const k = new Probe();
k.setA();
k.setB();
console.log(Object.keys(k).join(','));

const g = new Probe();
g.setB();
g.setA();
console.log(g);

class Walk {
  constructor() { this.s = 's'; }
  setN() { this.n = 1; }
  setM() { this.m = 2; }
}
const w1 = new Walk();
w1.setN();
w1.setM();
const seen1 = [];
for (const key in w1) seen1.push(key);
console.log(seen1.join(','));
const w2 = new Walk();
w2.setM();
w2.setN();
const seen2 = [];
for (const key in w2) seen2.push(key);
console.log(seen2.join(','));

class Drop {
  constructor() { this.p = 1; }
  setA() { this.a = 'A'; }
  setB() { this.b = 'B'; }
  drop() { delete this.a; }
}
const d = new Drop();
d.setA();
d.setB();
d.drop();
d.setA();
console.log(Object.keys(d).join(','));
