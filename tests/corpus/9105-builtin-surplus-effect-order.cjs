'use strict';
// A standard-library call with more arguments than it declares: JS evaluates
// every argument in order (the surplus ones included) and drops the surplus.
// The declared arguments keep their values, and the surplus effects run after
// them and before the call reads its receiver.
const log = [];
function tag(x) { log.push(x); return x; }
console.log(Math.abs(tag(-3), tag('m')), log.join(','));
console.log(String(tag(12), tag('s')), log.join(','));
console.log(Object.keys({ a: 1 }, tag('k')).length, log.join(','));
console.log(Math.floor(tag(1.5), tag(2)) + 1, log.join(','));
console.log('abc'.toUpperCase(tag(9)), log.join(','));
console.log([3, 1].at(0, tag('at')), log.join(','));
console.log(parseInt('12', 10, tag('p')), log.join(','));
console.log(Math.abs(-7, 8), String(5, 6), Object.keys({ z: 1 }, 2).join('|'));
const a = [1, 2, 3];
console.log(a.at(-1, a.push(9)), a.length);
let x = 4;
console.log(Math.abs(x, (x = 5)), x);
const o = { k: 1 };
console.log(Object.keys(o, (o.j = 2)).join('|'));
let r = [7, 8];
console.log(r.at(0, (r = [9])), r[0]);
console.log(Math.floor(tag(2.5), tag(3)), log.join(','));
