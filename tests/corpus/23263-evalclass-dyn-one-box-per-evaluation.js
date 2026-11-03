// One class value per evaluation: two crossings of one evaluation share one function object, so an expando
// written through one is read through the other, identity holds, and Object.keys lists statics then expandos.
function anyv(x) { return x; }
const mk = (n = 0) => class T { static n = n; };
const h = {}; h.T = mk(3);
const a = anyv(h.T), b = anyv(h.T);
a.extra = 7;
console.log(a === b, b.extra, Object.keys(b), a.n);
b.extra = 8; console.log(a.extra);
