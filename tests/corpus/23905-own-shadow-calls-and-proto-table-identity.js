"use strict";
// An own property written under a run-time key shadows a method for calls (this instance only, the prototype's function is
// untouched); a prototype-table member is the same function through every instance and through the prototype.
class Base {
  constructor() {
    this.opts = { p: "k:" };
  }
  put(name, v) {
    this[name] = v;
  }
  hello() {
    return "base-hello";
  }
  who() {
    return "base-who";
  }
  twice() {
    return this.hello() + "+" + this.hello();
  }
}
Base.prototype["dyn" + 1] = function () {
  return "proto-dyn1:" + this.who();
};
const b = new Base();
const c = new Base();
console.log(String(b.hello()), String(c.hello()), String(b.twice()));
b.put("hello", function () {
  return "own-hello";
});
console.log(String(b.hello()), String(c.hello()), String(b.twice()), String(c.twice()));
console.log(String(b.dyn1()), String(c.dyn1()), Base.prototype.dyn1 === b.dyn1, c.dyn1 === b.dyn1);
b.put("dyn1", function () {
  return "own-dyn1";
});
console.log(String(b.dyn1()), String(c.dyn1()));
b.put("who", 5);
let threw = "no";
try {
  b.who();
} catch (e) {
  threw = e instanceof TypeError ? "TypeError" : "other";
}
console.log(threw, String(c.who()));
