class A { constructor() { this.v = 'a'; } m() { const g = () => this.v; return g(); } }
const a = new A();
const f = a.m;
try { console.log(f()); } catch (e) { console.log(e.name + ': ' + e.message); }
console.log(a.m());
class B { constructor() { this.v = 'b'; } m() { return 'B'; } }
class C extends B { m() { return 'C'; } }
const c = new C();
const h = c.m;
console.log(h());
