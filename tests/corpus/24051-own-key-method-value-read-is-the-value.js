"use strict";
// A method read as a VALUE from an instance whose own properties (written under run-time keys) can shadow it with a value of
// any type: the read is the actual value, so a shadowing number is the number.
class Box {
  put(k, v) {
    this[k] = v;
  }
  hello() {
    return "hello";
  }
}
const b = new Box();
b.put("hello", 5);
const f = b.hello;
console.log(typeof f);
