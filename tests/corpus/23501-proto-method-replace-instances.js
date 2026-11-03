// C.prototype.m = f: existing and future instances, a subclass that does not override, identity, the original through old.call.
class A {
  constructor(a) { this.a = a; }
  m(x) { return "A.m:" + this.a + ":" + x; }
  n() { return "A.n:" + this.a; }
}
class B extends A {}
class C extends B { tag() { return "C"; } }
const before = new A(1), before2 = new C(2);
console.log(before.m("x"), before2.m("x"), new B(3).m("y"));
const old = A.prototype.m;
function f(x) { return "f:" + this.a + ":" + x + ":" + this.n(); }
A.prototype.m = f;
const after = new A(4), after2 = new B(5), after3 = new C(6);
console.log(before.m("p"), before2.m("p"), after.m("q"), after2.m("q"), after3.m("q"));
console.log(before.m === f, after2.m === f, A.prototype.m === f, B.prototype.m === f, old === f, typeof old);
console.log(old.call(after, "o"), old.call(after3, "o"));
console.log(before.n(), after3.tag());
const g = function (x) { return "g:" + x + ":" + (this === after); };
A.prototype.m = g;
console.log(after.m("z"), A.prototype.m === g, after.m === g, f === g);
