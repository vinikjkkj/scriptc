'use strict';
// ===/!== between an untyped (any) value and every kind it can be compared
// with: class values, class instances (identity), maps, sets, bigints,
// scalars, functions, undefined and null.
class A { constructor(v) { this.v = v; } }
class B extends A {}
class C {}
const a = new A(1);
const b = new B(2);
const m = new Map([[1, 'x']]);
const s = new Set([1]);
const f = function f() { return 1; };
function isA(x) { return x.constructor === A; }
function notA(x) { return x.constructor !== A; }
function isB(x) { return x.constructor === B; }
function isC(x) { return x.constructor === C; }
console.log(isA(a), isA(b), isA(42), isA(null === null ? {} : 0));
console.log(notA(a), notA(b), notA(new C()), isB(b), isB(a), isC(new C()));
function same(x, y) { return x === y; }
function diff(x, y) { return x !== y; }
console.log(same(a, a), same(a, b), diff(a, a), diff(a, {}));
console.log(same(m, m), same(m, new Map()), diff(s, s), same(s, new Set([1])));
console.log(same(10n, 10n), same(10n, 11n), diff(5n, 5n), same(5n, 5));
console.log(same(f, f), same(f, function f() { return 1; }), diff(f, f));
console.log(same(NaN, NaN), same(0, -0), diff(NaN, NaN), diff(0, -0));
console.log(same('a', 'a'), same(1, '1'), same(true, true), same(undefined, null));
console.log(same(undefined, undefined), same(null, null), diff(null, undefined));
