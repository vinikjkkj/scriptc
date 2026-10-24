// A class passed to untyped code is a value the untyped code can construct
// with `new`, name, compare, read statics of and print. It was SC1101 "converting typed values to 'unknown'" at the call.
'use strict';

class A {
  static k = 5;
  static tag = "a";
  static make() { return new A(9); }
  static describe(x) { return "A:" + x; }
  constructor(v) { this.v = v; }
  m() { return this.v; }
}
class B extends A {
  static own = "b";
  constructor(v) { super(v + 1); this.extra = true; }
}
class Plain { constructor(a, b) { this.a = a; this.b = b; } }

function mk(C, v) { return new C(v); }
function mk2(C, a, b) { return new C(a, b); }
function st(C) { return C.make().v + C.k; }
function nm(C) { return C.name; }
function same(a, b) { return a === b; }
function kindOf(C) { return typeof C; }
function show(x) { console.log(x); }
function holder(h) { return new h.cls(4).m(); }
function readStatic(C, key) { return C[key]; }
function writeStatic(C, key, v) { C[key] = v; return C[key]; }
function callStatic(C, key, arg) { return C[key](arg); }

console.log(mk(A, 3).m(), mk(B, 3).m(), st(A), st(B), nm(A), nm(B), kindOf(A));
console.log(same(A, A), same(A, B), same(A, new A(1).constructor), same(B, new B(1).constructor));
console.log(holder({ cls: B }), holder({ cls: A }));
console.log(mk2(Plain, 1, 2).b, mk2(Plain, 1).b);
console.log(readStatic(A, "tag"), readStatic(B, "tag"), readStatic(B, "own"), readStatic(A, "own"));
console.log(callStatic(A, "describe", 7), callStatic(B, "describe", 8));
console.log(writeStatic(A, "tag", "z"), A.tag, readStatic(B, "tag"));
show(Plain);
show(B);
show(A);
show([Plain, A].length);
function pick(flag) { return flag ? A : B; }
console.log(nm(pick(true)), nm(pick(false)), mk(pick(false), 1).extra);
function t(name, f) { try { console.log(name, f()); } catch (e) { console.log(name, "THROW", e.name, e.message); } }
function callIt(C) { return C(1); }
t("call without new", () => callIt(A));
t("absent static", () => readStatic(A, "nope"));
