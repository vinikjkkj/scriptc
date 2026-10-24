class K { constructor() { this.v = 1; } get() { console.log('before'); return this.v; } }
const k = new K();
const f = k.get;
try { console.log(f()); } catch (e) { console.log(e.name + ': ' + e.message); }
console.log('after');
