// assert.deepStrictEqual / notDeepStrictEqual over two DIFFERENT untyped
// Maps or Sets: Node compares entries (size, then each entry of one against a
// distinct equal entry of the other: SameValueZero for a primitive key,
// deepStrictEqual for an object key). The compiled runtime used to refuse
// with "deepStrictEqual on a dynamic Map is not supported yet" because a map
// box could not hand out its entries. A Map is never equal to a Set, and two
// distinct WeakMaps are never equal.
'use strict';

const assert = require("assert");
function mk() { return new Map(); }
function mks() { return new Set(); }
function eq(a, b) { try { assert.deepStrictEqual(a, b); return true; } catch (e) { return false; } }
function ne(a, b) { try { assert.notDeepStrictEqual(a, b); return true; } catch (e) { return false; } }
const a = mk(), b = mk();
console.log(eq(a, b));
a.set("x", 1); a.set(2, "two"); a.set(NaN, 0);
b.set(2, "two"); b.set(NaN, 0); b.set("x", 1);
console.log(eq(a, b), ne(a, b));
b.set("x", 2); console.log(eq(a, b), ne(a, b));
b.set("x", 1); b.set("y", 1); console.log(eq(a, b));
const k1 = {}, k2 = {};
const m1 = mk(), m2 = mk();
m1.set(k1, "v"); m2.set(k2, "v");
console.log(eq(m1, m2));
const s1 = mks(), s2 = mks();
s1.add(1); s1.add("a"); s2.add("a"); s2.add(1);
console.log(eq(s1, s2));
s2.add(2); console.log(eq(s1, s2));
console.log(eq(mk(), mks()));
const w1 = new WeakMap(), w2 = new WeakMap();
console.log(eq(w1, w1), eq(w1, w2));
console.log(eq(new Map([["a", 1]]), (function () { const m = mk(); m.set("a", 1); return m; })()));
console.log(eq([mk()], [mk()]), eq({ m: a }, { m: b }));
