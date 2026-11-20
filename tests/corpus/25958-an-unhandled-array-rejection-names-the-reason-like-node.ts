// @exit: 1
// A rejection nobody handles, whose reason is an array: the report names the reason as `[object Array]`.
const p: Promise<void> = Promise.reject([1, "a"]);
console.log("before");
void p;
