// A field written only under a condition: the instances that skip the write keep reading undefined from the prototype.
class Gate {
  constructor(open) { if (open) this.code = 'open'; }
}
Gate.prototype.code = undefined;
const g1 = new Gate(true);
const g2 = new Gate(false);
console.log(g1.code, g2.code, 'code' in g2, Object.keys(g1), Object.keys(g2));
