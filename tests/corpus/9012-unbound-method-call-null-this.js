class A { constructor() { this.v = 'a'; } m() { return this.v; } }
const a = new A();
try { console.log(A.prototype.m.call(null)); } catch (e) { console.log(e.name + ': ' + e.message); }
try { console.log(A.prototype.m.call(undefined)); } catch (e) { console.log(e.name + ': ' + e.message); }
console.log(a.m());
