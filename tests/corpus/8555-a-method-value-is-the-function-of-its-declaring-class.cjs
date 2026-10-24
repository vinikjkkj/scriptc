// `a.m === A.prototype.m`: a method read off an instance, off the prototype, off a subclass that
// inherits it, or through an A-typed receiver that is really a B, is the one function of the class
// that declares it (the runtime class picks the override). It printed false where Node prints true.
'use strict';
class A { constructor() { this.v = 1; } m() { return 'A.m' + this.v; } n() { return 'A.n'; } who() { return this.m; } }
class B extends A { m() { return 'B.m' + this.v; } }
class C extends B { }
class D extends A { }
const a = new A(), b = new B(), c = new C(), d = new D();
console.log(a.m === A.prototype.m, b.m === B.prototype.m, b.m === A.prototype.m, c.m === B.prototype.m, c.m === C.prototype.m);
console.log(d.m === A.prototype.m, d.m === D.prototype.m, a.n === b.n, a.n === A.prototype.n, c.n === A.prototype.n);
console.log(a.who() === A.prototype.m, b.who() === B.prototype.m, c.who() === B.prototype.m, d.who() === A.prototype.m);
console.log(a.m === a.m, a.m === a.n, b.m === a.m);
const f = b.m;
console.log(f.call(b), A.prototype.m.call(b), A.prototype.m.call(c));
