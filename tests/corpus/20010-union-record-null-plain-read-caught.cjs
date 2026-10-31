// Corpus 20010: a plain read of a field through a record-or-null return: the null arm throws Node's TypeError.
function mk(n) { return n ? { a: 1, b: 'x' } : null; }
const r = mk(0);
try { console.log(r.a); } catch (e) { console.log('caught', e.name, e.message); }
