// Two classes each with their own undefined datum of the same name: each instance reads its own class's slot.
class A1 {
  constructor() { this.a = 1; }
  set1(v) { this.tag = 'A' + v; }
}
class B1 {
  constructor() { this.b = 2; }
  set2(v) { this.tag = 'B' + v; }
}
A1.prototype.tag = undefined;
B1.prototype.tag = undefined;
const a1 = new A1();
const b1 = new B1();
a1.set1(1);
console.log(a1.tag, b1.tag);
b1.set2(2);
console.log(a1.tag, b1.tag);
