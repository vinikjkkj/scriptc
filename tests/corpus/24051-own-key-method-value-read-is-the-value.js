"use strict";
// A method read as a VALUE from an instance whose own properties (written under run-time keys) can shadow it with a value of
// any type: the read is typed as the method, so it is refused; calling the method is exact.
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
