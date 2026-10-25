// Two undefined prototype data names beside each other, each written by a different method; only the written instance sees a value.
class CD {
  constructor(n) { this.n = n; }
  setA(v) { this.ea = 'a' + v; }
  setB(v) { this.eb = 'b' + v; }
}
CD.prototype.ea = undefined;
CD.prototype.eb = undefined;
const x = new CD(1);
const y = new CD(2);
x.setB(7);
console.log(x.ea, x.eb, y.ea, y.eb, 'ea' in x, 'eb' in y);
y.setA(8);
console.log(x.ea, y.ea, y.eb);
