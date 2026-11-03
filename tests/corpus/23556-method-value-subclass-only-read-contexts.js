// The read of a subclass-only method in the value contexts that cannot hand the function to a call with another
// receiver: a comparison, typeof, a truth test, a conditional, and a comparison against another instance's read.
class Base {
  constructor(tag) {
    this.tag = tag;
  }
  eq(o) {
    return this.act === o.act;
  }
  ne(o) {
    return this.act !== o.act;
  }
  kind() {
    return typeof this.act;
  }
  test() {
    if (this.act) {
      return 'has';
    }
    return 'lacks';
  }
  cond() {
    return !this.act ? 'lacks' : 'has';
  }
  proto() {
    return this.act === A.prototype.act;
  }
}
class A extends Base {
  act(n) {
    return 'A' + this.tag + n;
  }
}
class B extends Base {
  act(n) {
    return 'B' + this.tag + n;
  }
}
class C extends A {}
class D extends Base {}
const a = new A('a');
const b = new B('b');
const c = new C('c');
const d = new D('d');
console.log(a.eq(c), a.eq(b), c.eq(a), a.eq(d), d.eq(d), d.eq(a));
console.log(a.ne(c), a.ne(b), d.ne(a));
console.log(a.kind(), b.kind(), c.kind(), d.kind());
console.log(a.test(), b.test(), c.test(), d.test());
console.log(a.cond(), d.cond());
console.log(a.proto(), b.proto(), c.proto(), d.proto());
