// @exit: 1
// A rejection nobody handles, whose reason is a Uint8Array: named `[object Uint8Array]`.

console.log("before");
const p: Promise<void> = Promise.reject(new Uint8Array(2)); void p;
