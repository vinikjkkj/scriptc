'use strict';
// JSON.stringify with a space that is a run-time number or string: the number
// is clamped to 0..10 spaces (NaN and fractions truncate), the string keeps
// its first 10 UTF-16 units, and an empty gap is the compact text.
const v = { a: [1, { b: 'x,{y}:z"q\\"' }], e: {}, f: [], g: 'k' };
const nums = [2, 0, -1, NaN, 20, 3.9, 1];
for (const n of nums) console.log(JSON.stringify(v, null, n));
const strs = ['xy', '', 'abcdefghijklmnop', '\u{1F600}\u{1F600}\u{1F600}\u{1F600}\u{1F600}\u{1F600}', 'é€ab'];
for (const s of strs) console.log(JSON.stringify(v, null, s));
const d = JSON.parse('{"p":[1,2,{"q":null}],"r":"s"}');
console.log(JSON.stringify(d, null, 4));
console.log(JSON.stringify([], null, 2), JSON.stringify(7, null, 3), JSON.stringify('h', null, 'ab'));
let k = 0;
function tag(x) { k++; return +x; }
console.log(JSON.stringify(v, null, tag(2)) === JSON.stringify(v, null, 2), k);
