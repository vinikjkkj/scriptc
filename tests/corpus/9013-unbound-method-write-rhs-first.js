class A { constructor() { this.v = 0; } set() { this.v = (console.log('rhs'), 5); return this.v; } }
const a = new A();
const g = a.set;
try { console.log(g()); } catch (e) { console.log(e.name + ': ' + e.message); }
class B { constructor() { this.v = 0; } inc() { this.v += (console.log('rhs2'), 1); return 1; } }
const b = new B();
const h = b.inc;
try { console.log(h()); } catch (e) { console.log(e.name + ': ' + e.message); }
