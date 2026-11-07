// `createDebug[key] = env[key]` over a function declaration that also has by-name members (debug common.js): the computed-key write can overwrite any of them, so
// the function keeps all its own properties in its closure table and every read, call and write sees the same value.
function createDebug(ns) { return "dbg:" + ns; }
createDebug.base = 1;
createDebug.coerce = function (v) { return "c" + v; };
const env = { a: 1, b: "two", c: function () { return 3; }, base: 99 };
Object.keys(env).forEach((key) => {
  createDebug[key] = env[key];
});
console.log(createDebug.a, createDebug.b, createDebug.c(), createDebug("x"), createDebug.base, createDebug.coerce(2));
function plain() { return 1; }
plain.tag = "t";
plain.n = 2;
console.log(plain.tag, plain.n, plain());
