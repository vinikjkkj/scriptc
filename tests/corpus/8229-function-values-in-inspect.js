// A function VALUE held in a class field or an object member prints through
// util.inspect with the name Node gives it: a declared function keeps its
// name, a property-assigned arrow is anonymous, an object-literal member
// takes the member's name. The class instances below hold the callback in a
// slot written outside the constructor's top level (absent until written)
// and in a slot written at the top level.
function foo(v) {
  return v;
}
class A {
  constructor(f) {
    this.tag = "t";
    if (f) this.arm();
  }
  arm() {
    this.cb = foo;
  }
}
class B {
  constructor() {
    this.cb = (v) => v + 1;
  }
}
console.log(new A(true));
console.log(new A(false));
console.log(new B());
const o = { cb: (v) => v };
console.log(o);
console.log(new B().cb(41));
