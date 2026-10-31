// Corpus 20012: a class-or-undefined return read plainly: the undefined arm throws Node's TypeError.
class K { constructor(x) { this.x = x; } }
function g(n) { return n ? new K(3) : undefined; }
const u = g(0);
try { console.log(u.x); } catch (e) { console.log('caught', e.name, e.message); }
