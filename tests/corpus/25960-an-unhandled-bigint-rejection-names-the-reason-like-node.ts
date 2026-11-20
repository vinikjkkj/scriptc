// @exit: 1
// A rejection nobody handles, whose reason is a bigint: named by its digits.

console.log("before");
const p: Promise<void> = Promise.reject(10n); void p;
