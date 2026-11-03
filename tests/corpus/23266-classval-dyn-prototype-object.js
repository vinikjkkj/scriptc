// A declared class's prototype object through dyn: identity, constructor, methods, base link, own names, Object.create(P) instances.
function anyv(x) { return x; }
class A { constructor(a) { this.a = a; } m1() { return "m1:" + this.a; } m2(x) { return x + this.a; } }
class B extends A { m2(x) { return "B" + super.m2(x); } m3() { return 3; } }
const KA = anyv(A), KB = anyv(B);
console.log(typeof KA.prototype, KA.prototype === KA.prototype, KB.prototype === KB.prototype, KA.prototype !== KB.prototype);
console.log(KB.prototype.constructor === KB, KA.prototype.constructor === KA, Object.keys(KB.prototype), KB.prototype.m1 === KA.prototype.m1, KB.prototype.m2 === KA.prototype.m2);
const b = new KB(2);
console.log(KB.prototype.m2.call(b, 1), KB.prototype.m3.call(b), KA.prototype.m2.call(b, 1));
console.log(KA.prototype["isPrototypeOf"](b), KB.prototype["isPrototypeOf"](new KA(1)), b instanceof KA);
const o = Object.create(KA.prototype);
console.log(o instanceof KA, o instanceof KB, typeof o.m1);
console.log(KB.prototype, KA.prototype, Object.getOwnPropertyNames(KB.prototype));
