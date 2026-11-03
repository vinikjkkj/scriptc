"use strict";
// Membership and reads of an instance that carries run-time keyed members: the `in` operator over own keys, prototype-table keys and methods, and an own key that shadows a method.
class Box {
  constructor() {
    this.id = 7;
  }
  put(k, v) {
    this[k] = v;
  }
  tag() {
    return "box";
  }
}
Box.prototype["proto" + "A"] = function () { return "pa"; };
function c0() { return new Box(); }
const b = new Box();
b.put("alpha", 1);
b.put("beta", "two");
b.put("tag", 5);
b.put("gamma", [1, 2]);
console.log("alpha" in b, "protoA" in b, "nope" in b, "tag" in b, "put" in c0());
console.log(String(b.alpha), String(b["beta"]), b.gamma.length);
const c = new Box();
console.log(c.tag(), c.id, c.alpha);
