// @exit: 1
// A rejection nobody handles, whose reason is a Date: named `[object Date]`.

console.log("before");
const p: Promise<void> = Promise.reject(new Date(0)); void p;
