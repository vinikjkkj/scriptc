// `this.m = fn` in a constructor creates an OWN property that wins over the
// prototype method of the same name: typed calls, calls through a base-typed
// or untyped receiver, a method that was never shadowed, siblings, and a
// subclass of the shadowing class all see it; an instance whose constructor
// did not run the assignment (the base) keeps the method. Node is the oracle.
const log = [];
class A {
  constructor(n) { this.n = n; }
  foo(x) { log.push("A.foo" + x); return x + this.n; }
  note(m) { log.push("A.note:" + m); }
  keep() { return "keep"; }
}
class B extends A {
  constructor(n) {
    super(n);
    this.foo = (x) => x * 100 + n;
    this.note = (m) => { log.push("B.note:" + m); };
  }
}
class B2 extends B { extra() { return 1; } }
class C extends A { foo(x) { return "C" + x; } }
function run(a, v) { a.note(v); return a.foo(v); }
const items = [new A(1), new B(2), new B2(3), new C(4)];
console.log(items.map((it) => run(it, 5)).join(" "));
console.log(log.join(","));
const b = new B(7);
console.log(b.foo(1), b.n, items[0].foo(2), b.keep(), new B2(9).foo(2));
