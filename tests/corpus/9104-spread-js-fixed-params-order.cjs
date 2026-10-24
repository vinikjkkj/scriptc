'use strict';
// A spread into fixed parameters of a JS function: missing positions are
// undefined, surplus elements are evaluated and dropped, and the spread's
// operands keep their source order with the declared arguments.
function f(a, b, c) { return [a, b, c].map((x) => (x === undefined ? 'U' : String(x))).join('|'); }
const xs = [1, 2];
console.log(f(...xs));
console.log(f(...[7, 8, 9, 10]));
console.log(f(0, ...xs));
console.log(f(...[]));
const log = [];
function tag(x) { log.push(x); return x; }
function g(a, b) { return a + ':' + b; }
console.log(g(tag(1), ...[tag(2), tag(3)]), log.join(','));
function h(a, b) { return String(a) + '/' + String(b); }
console.log(h(...[tag('p'), tag('q')]), log.join(','));
console.log(h(...[], 5));
