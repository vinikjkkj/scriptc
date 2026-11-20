// @exit: 1
// A rejection nobody handles, whose reason is null.

console.log("before");
const p: Promise<void> = Promise.reject(null); void p;
