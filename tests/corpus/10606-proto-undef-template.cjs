// Template and concatenation of a prototype datum read: undefined stringifies the same way on both sides.
class Node2 {
  constructor(v) { this.v = v; }
  stamp() { this.stamp2 = "ok"; }
}
Node2.prototype.stamp2 = undefined;
const n = new Node2(9);
console.log(`stamp=${n.stamp2}`, 'x' + n.stamp2);
n.stamp();
console.log(`stamp=${n.stamp2}`, n.v);
