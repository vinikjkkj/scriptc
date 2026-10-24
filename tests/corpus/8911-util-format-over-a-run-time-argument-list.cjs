// util.format where the argument list is a run-time fact: a format string held in a variable, a spread, and
// `util.format.apply(util, arguments)` (generate-function's `line(fmt, ...)`). Every specifier the formatter
// has, then the trailing-argument and escape rules.
var util = require('util');

function line(fmt) {
  if (arguments.length === 1) return fmt;
  return util.format.apply(util, arguments);
}
console.log(line('plain %s'));
console.log(line('var %s = %d;', 'x', 42));
console.log(line('%s:%s', 'a'));
console.log(line('%s', 'a', 'b', 3));
console.log(line('%d%%', 50));

function viaSpread(...a) { return util.format(...a); }
console.log(viaSpread());
console.log(viaSpread('%s=%s', 'k', 'v'));
console.log(viaSpread('no specifiers', 1, 'two', true, null, undefined));
console.log(viaSpread('%i %f %d', '12.9px', '3.5e2x', '0x10'));
console.log(viaSpread('%j', { a: [1, { b: 2 }], c: 'x' }));
console.log(viaSpread('%j|%j', undefined, 'q'));
console.log(viaSpread('%O', { a: { b: { c: { d: 1 } } } }));
console.log(viaSpread('%o', { a: 1, s: 'x' }));
console.log(viaSpread('%c styled', 'color: red'));
console.log(viaSpread('%x %s', 'z'));
console.log(viaSpread('%', 'a'));
console.log(viaSpread('100%', 5));
console.log(viaSpread(7, 'x', { k: 1 }));
console.log(viaSpread('%s', { k: 1, n: { m: 2 } }));
console.log(viaSpread('%s %s', -0, 1.5));
console.log(viaSpread('%d', '  7 '), viaSpread('%d', true), viaSpread('%d', null), viaSpread('%d', undefined));

var fmt = process.argv.length > 99 ? 'never' : '[%s] %s -> %d';
console.log(util.format(fmt, 'tag', 'msg', 3));
console.log(util.format(fmt));
var parts = ['%s+%s', 'l', 'r'];
console.log(util.format.apply(null, parts));
console.log(util.format.call(null, '%s/%s', 'c', 'd'));
console.log(util.format.apply(util, ['%s!', 'lit']));
console.log(util.format.apply(util, []) === '');
