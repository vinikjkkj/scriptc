// @exit: 1
// A rejection nobody handles, whose reason is a RegExp: named `[object RegExp]`.

console.log("before");
const p: Promise<void> = Promise.reject(/ab+/g); void p;
