// Symbol-keyed writes through an untyped parameter onto instances of plain classes (no run-time-keyed write anywhere in them): the class holds the properties, subclass included.
"use strict";
const kA = Symbol("a");
const kB = Symbol.for("b");
class Plain {
  constructor(n) { this.n = n; }
  get double() { return this.n * 2; }
}
class Sub extends Plain {
  constructor(n) { super(n); this.extra = 1; }
}
function tag(o, v) { o[kA] = v; o[kB] = v + 1; return o; }
function read(o) { return [o[kA], o[kB], kA in o, Object.hasOwn(o, kB), Object.getOwnPropertySymbols(o).length]; }
const p = tag(new Plain(2), 10);
const s = tag(new Sub(3), 20);
console.log(read(p), read(s), read(new Plain(1)), p.double, s.double);
console.log(p, s);
const c = { ...s };
console.log(Object.getOwnPropertySymbols(c).length, delete s[kA], read(s));
