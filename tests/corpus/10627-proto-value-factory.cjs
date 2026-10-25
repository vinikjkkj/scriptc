// Instances produced by a factory function; each reads the one prototype datum.
class Doc {
  constructor(t) { this.t = t; }
  setSub() { this.sub = 'x'; }
}
Doc.prototype.sub = 'none';
function make(t) {
  const d = new Doc(t);
  if (t === 'a') d.setSub();
  return d;
}
const d1 = make('a');
const d2 = make('b');
console.log(d1.sub, d2.sub, d1.t + d2.t);
