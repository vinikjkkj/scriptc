// Corpus 20011: the same record-or-null return read on the record arm: both fields answer.
function mk(n) { return n ? { a: 1, b: 'x' } : null; }
const q = mk(1);
console.log(q.a, q.b, q.a + 2, q.b.length);
