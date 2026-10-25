// Prototype reads inside branches and a switch, both before and after a later prototype write.
class Sw {
  constructor(k) { this.k = k; }
}
Sw.prototype.mode = 'idle';
/** @param {Sw} s */
function pick(s) {
  if (s.mode === 'idle') return 'I';
  return 'O';
}
const s1 = new Sw(1);
console.log(pick(s1));
Sw.prototype.mode = 'busy';
console.log(pick(s1), s1.mode);
