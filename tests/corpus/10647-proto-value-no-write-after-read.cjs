// A prototype datum that is read and never reassigned after the instances are made.
class Stable {
  constructor(id) { this.id = id; }
}
Stable.prototype.kind = 'stable';
const list = [new Stable(1), new Stable(2)];
const l0 = list[0];
console.log(list.map((s) => s.kind + s.id).join(' '), 'kind' in l0, Object.keys(list[1]));
