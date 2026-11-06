function* g(): Generator<number, void, undefined> { yield 1; }
const it = g();
console.log(it.next());
console.log(it.next());
console.log(it.next());
function* h(): Generator<number, string, undefined> { yield 1; return "r"; }
const j = h(); console.log(j.next()); console.log(j.next());
const r = j.next(); console.log(r, JSON.stringify(r), Object.keys(r));
