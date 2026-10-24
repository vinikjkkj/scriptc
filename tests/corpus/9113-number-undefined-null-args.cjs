'use strict';
// copyWithin and fill with two arguments (the end position defaults), and Number with
// undefined, null, a missing operand and surplus operands.
const a = [1,2,3,4,5];
console.log(a.copyWithin(0, 3));
console.log([1,2,3,4].fill(9, 2));
console.log(Number('12', 99));
console.log(Number());
console.log(Number(' 7 ', 'x'));
console.log(Number(null), Number(undefined), Number(null, 3), Number(), Number(2, 3));
let q = null;
console.log(Number(q), Number(q, 1));
