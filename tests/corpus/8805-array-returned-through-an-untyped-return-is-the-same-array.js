// A function stored in an object literal and returning an array it did not
// build hands back the SAME array: === holds against the original, and a push
// through the result is visible through the original. The returned box used to
// be a copy with no origin, so both answered as if two arrays existed.
'use strict';

const arr = [1, 2, 3];
const d = { a: { table() { return arr; } } };
function same(x, y) { return x === y; }
console.log(same(d.a.table(), arr));
const t = d.a.table();
t.push(4);
console.log(arr.length, t.length, d.a.table().length);
function pick(o) { return o.a.table(); }
const u = pick(d);
u.push(5);
console.log(arr.length, same(u, arr), same(u, t));
