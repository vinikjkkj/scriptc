function dd(o, k) { return o[k]; }
function mk(p, n) {
  const K = class {
    constructor() { this.v = n; }
    m() { return p + n; }
    both() { return p + this.v; }
    arrow() { return [1].map((x) => p + x + this.v).join(); }
    selfname() { return K.name + p; }
  };
  return new K();
}
const a = mk("p", 1), b = mk("q", 2);
const m = a.m, both = a.both, arrow = a.arrow, selfname = a.selfname;
console.log(m(), m.call(b));
try { console.log(both()); } catch (e) { console.log("T", e.name); }
console.log(both.call(b));
try { console.log(arrow()); } catch (e) { console.log("T", e.name); }
console.log(arrow.call(b));
console.log(selfname(), selfname.call(b));
console.log(a.m === a.m, a.m === b.m);
const dm = dd(a, "m");
console.log(dm(), dm.call(b), dm === a.m);
