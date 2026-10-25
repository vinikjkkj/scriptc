// A module-level function reads the datum off an instance argument, before and after a write.
class Pt {
  constructor(x) { this.x = x; }
  setLabel() { this.label = 'point'; }
}
Pt.prototype.label = 'pt';
/** @param {Pt} p */
function describe(p) { return 'P(' + p.x + ',' + p.label + ')'; }
const p = new Pt(3);
console.log(describe(p));
p.setLabel();
console.log(describe(p), describe(new Pt(4)));
