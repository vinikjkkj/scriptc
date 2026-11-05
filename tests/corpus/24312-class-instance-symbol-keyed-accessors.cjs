// A symbol-keyed accessor on a class instance (its property table): the getter and setter run with the instance as this, typed and through an untyped parameter, spread invokes the getter, inspect prints [Getter/Setter].
"use strict";
const kv = Symbol("value");
class Cell {
  constructor(n) { this.n = n; }
  put(key, x) { this[key] = x; }
}
const c = new Cell(5);
c.put("t", 1);
Object.defineProperty(c, kv, {
  get() { return this.n * 2; },
  set(v) { this.n = v; },
  enumerable: true,
  configurable: true,
});
console.log(c[kv]);
c[kv] = 21;
console.log(c.n, c[kv], c);
function viaDyn(o) { o[kv] = 4; return o[kv]; }
console.log(viaDyn(c), c.n);
const copy = { ...c };
console.log(copy[kv], Object.getOwnPropertySymbols(copy).length);
