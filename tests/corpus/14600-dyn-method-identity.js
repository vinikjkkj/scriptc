// A method read through a dynamic key is the SAME function value as the static read
// (`o[k] === o.m`, and a method stored then compared by key), not a fresh box per read.
// The value is unbound: calling it without a receiver fails as Node does, and calling it
// through .call(receiver) runs the method on that receiver. A missing key reads undefined.
class Cmd {
  constructor() { this.next = null; this.x = 1; }
  start(cb) { this.next = cb; return 'started'; }
  step() { this.next = this.start; return this.next; }
}
function getk(o, k) { return o[k]; }
const c = new Cmd();
console.log(getk(c, 'start') === c.start, getk(c, 'start') === Cmd.prototype.start);
console.log(getk(c, 'start') === getk(c, 'start'), getk(c, 'x'), getk(c, 'nope') === undefined);
const g = c.step();
console.log(g === c.start, getk(c, 'next') === g, getk(c, 'start') === g);
const f = getk(c, 'start');
try {
  f(() => 1);
  console.log('no throw');
} catch (e) {
  console.log(e instanceof TypeError);
}
console.log(f.call(c, () => 2), c.next !== null);
