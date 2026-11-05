// A class accessor keyed by a module symbol constant (`get [K]()`, K a `Symbol()` or a `Symbol.for` const): its body is
// lowered with the class and answers when the instance is read through a checked-dynamic parameter.
const K = Symbol("kk");
const R = Symbol.for("@@test.registry");
class V {
  get foo() { return 7; }
  get [K]() { return 8; }
  get [R]() { return 9; }
}
class W extends V {
  get own() { return 1; }
}
function rd(d) { return d.foo; }
function rs(d) { return [d[K], d[R]]; }
function has(d) { return [K in d, R in d, Symbol.for("@@other") in d]; }
console.log(rd(new V()), rs(new V()), rs(new W()), rs({ foo: 1 }));
console.log(has(new V()), has(new W()), has({}));
