"use strict";
// An instance that takes own properties under run-time keys lists them after its fields, but Node lists every own key in the
// order it was created: printing one is refused by name instead of answering a possibly different order.
class Box {
  constructor() {
    this.id = 7;
  }
  put(k, v) {
    this[k] = v;
  }
}
const b = new Box();
b.put("alpha", 1);
console.log(b);
