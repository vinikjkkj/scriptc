'use strict';
// String indexOf, includes, lastIndexOf and endsWith with their position
// argument: negative, NaN, past the end, an explicit undefined, and the
// empty needle. Node's clamps decide every answer.
const s = 'abcbxb';
const from = -2;
console.log(s.indexOf('b', 2), s.indexOf('b', from), s.indexOf('b', NaN), s.indexOf('b', 99), s.indexOf('b', -9));
console.log(s.includes('b', 3), s.includes('b', 99), s.includes('b', -1), s.includes('a', NaN));
console.log(s.lastIndexOf('b'), s.lastIndexOf('b', 4), s.lastIndexOf('b', 2), s.lastIndexOf('b', -1));
console.log(s.lastIndexOf('b', NaN), s.lastIndexOf('b', undefined), s.lastIndexOf('b', Infinity));
console.log(s.lastIndexOf('', 3), s.lastIndexOf('', 99), s.lastIndexOf('zz', 3), s.lastIndexOf('b', -Infinity));
console.log(s.endsWith('b', 4), s.endsWith('b', 3), s.endsWith('b', undefined), s.endsWith('x', NaN), s.endsWith('', -5));
const u = 'a\u{1F600}b\u{1F600}';
console.log(u.lastIndexOf('\u{1F600}', 2), u.lastIndexOf('\u{1F600}'), u.endsWith('\u{1F600}', 4), u.endsWith('b', 3));
