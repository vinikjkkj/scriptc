// A write into a class prototype object read from a dynamic value: an instance reaches its members through its class, not
// through that object, so the write would never be seen by `new V().extra()`. An evaluated class crossing into dyn in such a
// program keeps the compile-time refusal (reads of `prototype` are exact: corpus 23265).
function anyv(x) { return x; }
const mk = (n = 0) => class W { m() { return n; } };
const h = {}; h.W = mk(1);
const W = anyv(h.W);
W.prototype.extra = function () { return 9; };
const P = W.prototype; P.more = 1;
console.log(new W().extra());
