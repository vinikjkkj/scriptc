'use strict';
// JSON.stringify space at the 10-unit boundary: an astral character whose high half is
// the tenth UTF-16 unit keeps that half (Node prints it as U+FFFD). Run-time spaces only.
const s = 'abcdefghi\u{1F600}xyz';
console.log(JSON.stringify({ a: [1, { b: 2 }] }, null, s));
console.log(JSON.stringify([1,2], null, 'abcdefghij\u{1F600}'));
console.log(JSON.stringify([1,2], null, 'abcdefghi\u{1F600}'));
console.log(JSON.stringify([1,2], null, 'abcdefghij'));
const t = 'abcdefgh\u{1F600}';
console.log(JSON.stringify({ k: [3] }, null, t));
console.log('\uD83D', 'x');
