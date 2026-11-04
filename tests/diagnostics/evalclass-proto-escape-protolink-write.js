// Object.create(V.prototype) only links a child to the prototype object, but the child's `__proto__` hands the object back: a write through it cannot be tracked, so the crossing keeps the compile-time refusal at that write.
function anyv(x) { return x; }
const mk = (n = 0) => class W { m() { return n; } };
const h = {}; h.W = mk(1);
const W = anyv(h.W);
const child = Object.create(W.prototype);
child.__proto__.x = 1;
