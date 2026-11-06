function mk(p, n) {
  const K = class {
    constructor() { this.v = n; }
    m() { return p + n; }
    both() { return p + this.v; }
    static sm() { return p + n; }
    static sboth() { return p + this.name; }
  };
  return K;
}
const K1 = mk("p", 1), K2 = mk("q", 2);
const a = new K1(), b = new K2();
console.log(K1.prototype.m.call(b), K2.prototype.m.call(a), K1.prototype.m === a.m, K1.prototype.m === b.m);
const sm = K1.sm, sboth = K1.sboth;
console.log(sm(), sm.call(K2), sm.call(null));
try { console.log(sboth()); } catch (e) { console.log("T", e.name); }
console.log(sboth.call(K2));
console.log(K1.sm === K1.sm, K1.sm === K2.sm);
console.log(K1.prototype.both.call(b));
