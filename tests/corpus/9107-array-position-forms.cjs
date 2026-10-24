'use strict';
// Array indexOf, includes and lastIndexOf with a fromIndex, and join's
// default separator. NaN never matches under indexOf and lastIndexOf, but it
// does under includes.
const a = [1, 2, 1, 3, NaN];
const from = -2;
console.log(a.indexOf(1, 1), a.indexOf(1, from), a.indexOf(1, 99), a.indexOf(1, -99), a.indexOf(NaN, 0), a.indexOf(1, NaN));
console.log(a.includes(3, 1), a.includes(NaN, 1), a.includes(1, 4), a.includes(1, -2), a.includes(1, undefined));
console.log(a.lastIndexOf(1), a.lastIndexOf(1, 1), a.lastIndexOf(1, -2), a.lastIndexOf(1, -99), a.lastIndexOf(NaN), a.lastIndexOf(1, 99));
console.log(a.lastIndexOf(1, undefined), a.lastIndexOf(3, -1), [].lastIndexOf(1), [].lastIndexOf(1, 5));
console.log([1, 2].join(), [1, 2].join(undefined), [1, 2].join('-'), [].join());
