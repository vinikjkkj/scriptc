// @exit: 1
// A rejection nobody handles, whose reason is an object with its own toString: named `[object Object]`.

console.log("before");
const p: Promise<void> = Promise.reject({ toString() { return "custom"; } }); void p;
