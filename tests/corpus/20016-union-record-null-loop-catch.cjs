// Corpus 20016: a loop over mixed values; each plain read either answers or throws Node's TypeError.
function mk(i) { return i % 2 === 0 ? { v: i } : null; }
const out = [];
for (let i = 0; i < 4; i++) {
  const r = mk(i);
  try { out.push(r.v); } catch (e) { out.push(e.message); }
}
console.log(out.join(' | '));
