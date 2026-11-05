// Two symbols with one description are two keys on a boxed class instance too: a field, an accessor and a fresh Symbol("x") are told apart by the symbol, not its description.
"use strict";
const x1 = Symbol("x");
const x2 = Symbol("x");
class Box {
  constructor() { this[x1] = 1; this.n = 2; }
  get [x2]() { return "getter"; }
}
function rd(o, which) { return which === 1 ? o[x1] : o[x2]; }
function has(o) { return [x1 in o, x2 in o, Symbol("x") in o]; }
const b = new Box();
console.log(rd(b, 1), rd(b, 2), has(b), has({}));
function ho(o) { return [Object.hasOwn(o, x1), Object.hasOwn(o, x2)]; }
console.log(ho(b), ho({}));
const other = Symbol("x");
function rdo(o) { return o[other]; }
console.log(rdo(b), rdo({}));
