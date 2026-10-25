// A subclass without its own field reads the base's non-undefined datum; a later base write reaches it.
class P0 {
  constructor() { this.p = 1; }
  set0() { this.cat = 'c0'; }
}
P0.prototype.cat = 'base-cat';
class P1 extends P0 {
  constructor() { super(); this.q = 2; }
}
const p1 = new P1();
console.log(p1.cat, p1.p, p1.q);
P0.prototype.cat = 'base-cat-2';
const p0 = new P0();
console.log(p1.cat, p0.cat);
