class A { constructor() { this.v = 0; } set() { this.v = 5; return this.v; } }
const a = new A();
const g = a.set;
try { console.log(g()); } catch (e) { console.log(e.name + ': ' + e.message); }
console.log(a.v);
