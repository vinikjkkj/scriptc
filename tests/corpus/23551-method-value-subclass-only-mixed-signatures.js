// The declarers spell different signatures: a zero-parameter method, a two-parameter implicit-any method and a
// one-parameter method that mutates its receiver, so no single function type covers the read. Each read answers the
// declarer of the receiver's class, and the stored value is callable later through the field.
class Command {
  constructor() {
    this.next = null;
    this.trace = [];
  }
  run(a, b) {
    this.next = this.start;
    const r = this.next(a, b);
    this.trace.push(r);
    return r;
  }
}
class Zero extends Command {
  start() {
    return 'zero';
  }
}
class Two extends Command {
  start(a, b) {
    return 'two:' + a + ':' + b;
  }
}
class Counted extends Command {
  constructor() {
    super();
    this.n = 0;
  }
  start(a) {
    this.n++;
    return 'counted:' + a + ':' + this.n;
  }
}
const z = new Zero();
const t = new Two();
const c = new Counted();
console.log(z.run(1, 2), t.run(1, 2), c.run(7), c.run(8));
console.log(z.trace.length, t.trace.length, c.trace.join(','));
console.log(typeof z.next, typeof t.next, typeof c.next);
console.log(z.next.name, t.next.name, c.next.name, z.next.length, t.next.length, c.next.length);
console.log(z.next === t.next, c.next === c.next, z.next === Zero.prototype.start, t.next === Two.prototype.start);
