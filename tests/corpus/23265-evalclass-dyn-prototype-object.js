// An evaluated class value's prototype object: ONE per evaluation, `constructor`, the own methods as stable function values,
// no enumerable keys, its [[Prototype]] the base class's prototype, `instanceof` and isPrototypeOf agreeing, a computed 'prototype' key.
function anyv(x) { return x; }
class Base { constructor(a) { this.a = a; } hello() { return "hi" + this.a; } }
const mk = (n = 0) => class Made extends Base { constructor(a) { super(a); this.n = n; } who(x) { return "w" + this.a + ":" + x + ":" + n; } static s = 3; };
const h = {}; h.M = mk(5);
const M = anyv(h.M);
const P = M.prototype, P2 = anyv(M)["prototype"];
console.log(typeof P, P === P2, P.constructor === M, Object.keys(P), M.prototype === M.prototype);
console.log(typeof P.who, P.who === P.who, typeof P.hello, P.hello === anyv(Base).prototype.hello, Object.hasOwn(P, "hello"), Object.hasOwn(P, "who"));
const m = new M(7);
console.log(P.who.call(m, 1), P.hello.call(m), P["isPrototypeOf"](m), anyv(Base).prototype["isPrototypeOf"](m), P["isPrototypeOf"]({}));
console.log(P, anyv(Base).prototype);
const k = "prototype"; console.log(anyv(M)[k] === P, "who" in P, "hello" in P);
console.log(m instanceof M, m instanceof Base);
