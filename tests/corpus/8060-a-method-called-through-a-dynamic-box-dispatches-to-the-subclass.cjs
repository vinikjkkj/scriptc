// An instance handed to an untyped parameter boxes as its static base class;
// `a.foo(v)` must still run the override of the instance's OWN class (the
// registry resolves it by preorder position), for siblings, for a class
// two levels down, and for a base that is never boxed as itself. Node is
// the oracle.
class A {
  constructor(n) { this.n = n; }
  foo(x) { return x + this.n; }
  who() { return "A"; }
}
class B extends A {
  foo(x) { return x * 100; }
  who() { return "B"; }
}
class C extends A {
  foo(x) { return "C" + x; }
}
class D extends B {
  who() { return "D>" + super.who(); }
}
function run(a, v) { return [a.foo(v), a.who()]; }
const items = [new A(1), new B(2), new C(4), new D(8)];
for (const it of items) console.log(run(it, 5).join(" "));
console.log(items.map((it) => run(it, 1)[0]).join(","));
