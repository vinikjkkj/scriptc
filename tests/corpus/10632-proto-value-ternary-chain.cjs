// Chained conditionals over prototype data of two names.
class Pol {
  constructor(v) { this.v = v; }
  tagA() { this.ta = 'aye'; }
}
Pol.prototype.ta = 'none';
Pol.prototype.tb = 'bee';
const p = new Pol(0);
console.log(p.ta === 'none' ? p.tb : p.ta);
p.tagA();
console.log(p.ta === 'none' ? p.tb : p.ta);
