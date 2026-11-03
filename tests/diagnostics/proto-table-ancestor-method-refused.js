"use strict";
// A computed write on a subclass's prototype whose ancestor declares members: the write could shadow an ancestor's method, which
// the replacement slot cannot express, so it is refused by name.
class Base {
  keep() {
    return "keep";
  }
}
class Sub extends Base {}
const names = ["a", "b"];
names.forEach(function (n) {
  Sub.prototype[n] = function () {
    return n;
  };
});
console.log(new Sub().keep());
