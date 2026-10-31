// Corpus 20015: optional chains through a record-or-undefined value short-circuit (no throw); plain reads of the record stay exact.
function mk(n) { return n ? { a: 'xy', b: 2 } : undefined; }
const r = mk(0);
console.log(r?.a, r?.a.length, r?.b);
const s = mk(1);
console.log(s?.a, s?.a.length, s.b);
