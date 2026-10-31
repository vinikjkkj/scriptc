// A subclass instance calls a factory-installed prototype method inherited from its base.
"use strict";
class Base {
  constructor() { this.n = 7; }
}
function gen(name) {
  return function (x) { return name + ":" + this.n + ":" + x; };
}
Base.prototype.call = gen("call");
class Derived extends Base {
  constructor() { super(); this.m = 2; }
}
console.log(new Derived().call(3));
const plain = new Base();
console.log(plain.call(4));
