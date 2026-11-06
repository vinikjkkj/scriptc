const mk = new Function("p", "n", "return class { constructor(){ this.v = n } m(){ return p + n } both(){ return p + this.v } }");
const K1 = mk("p", 1), K2 = mk("q", 2);
const a = new K1(), b = new K2();
const m = a.m, both = a.both;
console.log(m(), m.call(b), a.m === a.m, a.m === b.m, K1.prototype.m.call(b));
try { console.log(both()); } catch (e) { console.log("T", e.name); }
console.log(both.call(b));
