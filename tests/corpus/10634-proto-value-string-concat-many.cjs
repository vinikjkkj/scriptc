// A string-valued prototype datum concatenated many times over a loop.
class Sep {
  constructor(n) { this.n = n; }
  mark() { this.tag2 = '+'; }
}
Sep.prototype.tag2 = '-';
let out = '';
const seps = [new Sep(1), new Sep(2)];
seps[1].mark();
for (let i = 0; i < 3; i++) {
  for (const s of seps) out += s.tag2;
}
console.log(out);
