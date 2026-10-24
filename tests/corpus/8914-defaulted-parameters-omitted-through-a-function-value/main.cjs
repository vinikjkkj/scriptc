'use strict';
const helpers = require('./helpers.cjs');

console.log(helpers.fieldEscape('a'), helpers.fieldEscape('b c', false), helpers.fieldEscape('q"'));
console.log(helpers.pad(7), helpers.pad(7, 6), helpers.pad(7, 6, '0'), helpers.pad('ab'));
console.log(helpers.scale(4), helpers.scale(4, 5));

// a binding in this file: the same arrow shape, called short
const esc = (field, isEval = true) => (isEval ? JSON.stringify(field) : field);
console.log(esc('x'), esc('y', false));
const tail = (a, b = a + 1, c = b * 2) => [a, b, c].join(',');
console.log(tail(1), tail(1, 5), tail(1, 5, 0));

// called through a table of closures
const table = { half: (n, d = 2) => n / d, neg: (n, flip = true) => (flip ? -n : n) };
console.log(table.half(9), table.half(9, 3), table.neg(5), table.neg(5, false));

try {
  helpers.fieldEscape('__proto__');
} catch (e) {
  console.log(e.message);
}
