// typeof x === 'symbol' on an untyped value is a real test, and sym.toString() on an untyped symbol answers Symbol(desc).
"use strict";
const k = Symbol("k");
function isSym(x) { return typeof x === "symbol"; }
function notSym(x) { return typeof x !== "symbol"; }
function bare(x) { return typeof x; }
function show(x) { return typeof x === "symbol" ? "sym:" + x.toString() + ":" + (x === k) : "other:" + String(x); }
console.log(isSym(k), isSym("a"), isSym(1), isSym(Symbol.for("r")), notSym(k), notSym({}), bare(k));
console.log(show(k), show(Symbol("z")), show(7), show("s"));
const box = JSON.parse('{"v":1}');
box.s = k;
console.log(isSym(box.s), isSym(box.v), show(box.s));
