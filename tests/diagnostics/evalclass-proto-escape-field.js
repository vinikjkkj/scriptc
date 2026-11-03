// A prototype object read from an evaluated class value ESCAPES (field): the write it could reach cannot be tracked, so the crossing keeps the compile-time refusal.
function anyv(x) { return x; }
const mk = (n = 0) => class W { m() { return n; } };
const h = {}; h.W = mk(1);
const W = anyv(h.W);

class Box { constructor(p) { this.p = p; } }
const b = new Box(W.prototype);
