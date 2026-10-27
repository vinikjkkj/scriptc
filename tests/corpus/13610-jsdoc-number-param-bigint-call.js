// @ts-nocheck
// A JSDoc `@param {number}` is the author's claim. These functions are called
// with a BigInt, so the parameter really is a bigint at run time, and the
// shift and asIntN operate on it. twice() is only ever called with a number
// and keeps its number parameter.
/** @param {number} value */
function low(value) {
  return Number(BigInt.asIntN(32, value));
}
/** @param {number} value */
function high(value) {
  return Number(BigInt.asIntN(32, value >> BigInt(32)));
}
/** @param {number} x */
function twice(x) {
  return x * 2;
}
console.log(low(5000000000n), high(5000000000n), high(1n << 40n), low(-1n), twice(21));
