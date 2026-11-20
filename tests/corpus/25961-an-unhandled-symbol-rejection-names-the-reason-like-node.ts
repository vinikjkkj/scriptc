// @exit: 1
// A rejection nobody handles, whose reason is a Symbol: named `Symbol(why)`.

console.log("before");
const p: Promise<void> = Promise.reject(Symbol("why")); void p;
