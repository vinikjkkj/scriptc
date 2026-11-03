"use strict";
// The same instance copied through a dynamic value (spread, which walks own keys in creation order): refused at the boxing site.
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
const copy = { ...b };
console.log(String(copy.id));
