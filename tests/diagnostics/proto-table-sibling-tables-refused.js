"use strict";
// Two classes of one family both write computed prototype members: one table per family is the exact design, so this is refused.
class Base {}
class Sub extends Base {}
["a"].forEach(function (n) {
  Base.prototype[n] = function () {
    return "base-" + n;
  };
});
["b"].forEach(function (n) {
  Sub.prototype[n] = function () {
    return "sub-" + n;
  };
});
const s = new Sub();
console.log(String(s.a()), String(s.b()));
