// Clone of a dyn-held SUBCLASS instance: the copy is the same runtime class
// (instanceof, the derived method), the base fields and the derived fields are
// all copied, and a runtime-defined property on the base is copied too.
class Base {
  constructor(n) {
    this.n = n;
  }
  bump() {
    this.n = this.n + 1;
    return this.n;
  }
}
class Child extends Base {
  constructor(n, m) {
    super(n);
    this.m = m;
  }
  describe() {
    return "child:" + this.n + ":" + this.m;
  }
  mark(k, v) {
    Object.defineProperty(this, k, { value: v, enumerable: true, writable: true, configurable: true });
  }
}
function pass(x) {
  return x;
}
const k = pass(new Child(2, "x"));
k.mark("tag", "T");
const c = Object.create(Object.getPrototypeOf(k), Object.getOwnPropertyDescriptors(k));
console.log(c instanceof Child, c instanceof Base, c.describe());
console.log(c.bump(), c.n, k.n);
console.log(c.m, c.tag, k.tag);
console.log(c.bump(), k.bump(), c.describe(), k.describe());
