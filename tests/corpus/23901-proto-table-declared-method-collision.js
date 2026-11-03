"use strict";
// A computed prototype write whose key names a method the class declares REPLACES it (every instance, every subclass
// that does not override it); a subclass's own method keeps winning; a key no class declares is a new member.
class Base {
  constructor() {
    this.tag = "base";
  }
  hello() {
    return "base-hello:" + this.tag;
  }
  keep() {
    return "keep";
  }
  call(n) {
    return "call-" + n + ":" + this.hello();
  }
}
class Sub extends Base {
  hello() {
    return "sub-hello>" + super.hello();
  }
  exec(x) {
    return "sub-exec:" + x;
  }
}
const writes = [
  ["hello", function () { return "replaced-hello:" + this.tag; }],
  ["exec", function (x) { return "proto-exec:" + x; }],
  ["fresh", function () { return "fresh:" + this.tag; }],
];
const s = new Sub();
const b = new Base();
console.log(b.hello(), s.hello(), s.exec(1), typeof b.exec, typeof b.fresh);
writes.forEach(function (w) {
  Base.prototype[w[0]] = w[1];
});
console.log(b.hello(), s.hello(), b.exec(2), s.exec(3), b.fresh(), s.fresh());
console.log(b.keep(), b.call(1), s.call(2));
console.log(Base.prototype.fresh === b.fresh, Base.prototype.fresh === s.fresh);
