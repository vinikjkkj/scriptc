// Array.prototype's second argument, the callback's `this` (postgres-interval's
// toPostgres): a `function` callback reads the thisArg through `this`, an
// arrow callback ignores it (the argument is still evaluated once), and every
// callback-taking method accepts it.
'use strict';
const ctx = { base: 10 };
const nums = [1, 2, 3, 4];
console.log(nums.map(/** @this {{base: number}} @param {number} n @returns {number} */ function (n) { return n + this.base; }, ctx).join(','));
console.log(nums.filter(/** @this {{base: number}} @param {number} n @returns {boolean} */ function (n) { return n * 5 > this.base; }, ctx).join(','));
console.log(nums.some(/** @this {{base: number}} @param {number} n @returns {boolean} */ function (n) { return n + this.base === 13; }, ctx));
console.log(nums.every(/** @this {{base: number}} @param {number} n @returns {boolean} */ function (n) { return n < this.base; }, ctx));
console.log(nums.find(/** @this {{base: number}} @param {number} n @returns {boolean} */ function (n) { return n * 5 > this.base; }, ctx));
console.log(nums.findIndex(/** @this {{base: number}} @param {number} n @returns {boolean} */ function (n) { return n * 5 > this.base; }, ctx));
nums.forEach(/** @this {{base: number}} @param {number} n @returns {void} */ function (n) { console.log(n * this.base); }, ctx);
console.log(nums.flatMap(/** @this {{base: number}} @param {number} n @returns {number[]} */ function (n) { return [n, n + this.base]; }, ctx).join(','));
let evals = 0;
const bump = () => { evals++; return ctx; };
console.log(nums.map((n) => n * 2, bump()).join(','), evals);
