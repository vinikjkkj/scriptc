// Corpus 20014: a null test before the plain read: the guarded forms answer on both arms.
function mk(n) { return n ? { a: 'hit' } : null; }
for (const n of [0, 1]) {
  const r = mk(n);
  console.log(r === null ? 'none' : r.a);
}
