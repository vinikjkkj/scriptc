// Instances built in a loop: only the ones a method wrote carry a value; the rest read the prototype undefined.
class Row {
  constructor(i) { this.i = i; }
  mark() { this.mark2 = 'x' + this.i; }
}
Row.prototype.mark2 = undefined;
const rows = [];
for (let i = 0; i < 4; i++) {
  const r = new Row(i);
  if (i % 2 === 0) r.mark();
  rows.push(r);
}
let out = '';
for (const r of rows) out += String(r.mark2) + ';';
console.log(out);
