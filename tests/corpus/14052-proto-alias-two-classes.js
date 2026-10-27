// Two subclasses alias the SAME inherited method under one name, and a third
// class inherits the alias: each installed method runs with this = its own
// receiver, and the body reads the receiver's own fields.
class Base {
  constructor(v) {
    this.v = v;
  }
  twice() {
    return this.v * 2;
  }
  label(p) {
    return p + "#" + this.v;
  }
}
class A extends Base {}
class B extends Base {
  constructor(v) {
    super(v);
    this.v = v + 100;
  }
}
class C extends A {}

A.prototype.dbl = Base.prototype.twice;
B.prototype.dbl = Base.prototype.twice;
A.prototype.tag = Base.prototype.label;

const a = new A(3);
const b = new B(4);
console.log(a.dbl(), b.dbl(), a.twice(), b.twice());
console.log(a.tag("x"), new C(5).dbl(), new C(6).tag("y"));
console.log(typeof a.dbl);
