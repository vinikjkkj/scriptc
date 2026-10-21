// Reflect.ownKeys / getOwnPropertyNames of a function VALUE the program
// declares: length and name first; sloppy plain functions add arguments and
// caller; plain functions, generators and classes add prototype; a class's
// statics follow in definition order; arrows, methods and async functions
// carry only length and name; strict code (a directive on the function)
// drops arguments and caller. Node is the oracle.
function a(x, y) {}
const b = (x) => x;
const c = function () {};
async function d() {}
function* g() {}
class K { static s() {} static t = 1; m() {} }
function strictFn() { "use strict"; }
console.log(Reflect.ownKeys(a).join(","));
console.log(Reflect.ownKeys(b).join(","));
console.log(Reflect.ownKeys(c).join(","));
console.log(Reflect.ownKeys(d).join(","));
console.log(Reflect.ownKeys(g).join(","));
console.log(Reflect.ownKeys(K).join(","));
console.log(Object.getOwnPropertyNames(a), Object.getOwnPropertyNames(K));
console.log(Reflect.ownKeys(strictFn));
