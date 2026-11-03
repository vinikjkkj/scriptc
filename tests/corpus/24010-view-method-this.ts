// A method member read through a view keeps the instance as `this`, and a write to the instance after the cast
// is seen by the method.
class Acc {
  n = 1;
  add(by: number): number {
    this.n += by;
    return this.n;
  }
  get double(): number {
    return this.n * 2;
  }
}
interface Adder { n: number; double: number; add(by: number): number }
const inst = new Acc() as unknown;
const m = inst as Adder;
console.log(m.add(2), m.n, (inst as Acc).n);
(inst as Acc).n = 10;
console.log(m.add(1), m.n);
m.n = 50;
console.log(m.add(1), (inst as Acc).n);
