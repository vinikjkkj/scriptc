// Corpus 20013: the class arm of a class-or-undefined return reads its field.
class K { constructor(x) { this.x = x; } }
function g(n) { return n ? new K(3) : undefined; }
const v = g(1);
console.log(v.x, v.x * 2);
