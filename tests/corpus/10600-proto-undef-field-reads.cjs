// A prototype datum of undefined on a class whose method assigns the field: unset instances read undefined, the field's own write shadows it, and 'name' in instance is true.
class CD {
  constructor(n) { this.n = n; }
  setExt(v) { this.ext = 'uuid:' + v; }
}
CD.prototype.ext = undefined;
const a = new CD('a');
console.log(a.ext, 'ext' in a, a.n, Object.keys(a));
a.setExt(1);
const b = new CD('b');
console.log(a.ext, b.ext, Object.keys(a), Object.keys(b));
