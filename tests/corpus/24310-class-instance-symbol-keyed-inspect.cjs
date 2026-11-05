// util.inspect of a class instance with symbol-keyed properties: from inside the class, through an array, and an instance holding only symbol keys.
"use strict";
const kA = Symbol("a");
class Box {
  constructor(v) { this.v = v; }
  put(key, x) { this[key] = x; }
  show() { console.log(this); console.log(require("node:util").inspect(this, { depth: 0 })); }
}
const b = new Box(1);
b.put("s", "str");
b[kA] = { deep: 1 };
b.show();
console.log([b]);
const e = new Box(2);
e.put("t", 1);
e[Symbol("only")] = 5;
console.log(e);
