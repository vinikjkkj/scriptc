// The global Promise read as a VALUE: bound to a name, held in a record, returned from an accessor (ioredis's
// `Object.defineProperty(exports, "Promise", { get() { return Promise; }, set(_lib) {} })`), passed as an argument and
// constructed through. One function object: `===` holds everywhere, `typeof` answers "function", a promise's prototype names it.
const P = Promise;
console.log(typeof P, P === Promise, P.name, P.length);

function getPromise() { return Promise; }
const target = {};
let stored;
Object.defineProperty(target, "Promise", {
  get() { return getPromise(); },
  set(lib) { stored = lib; },
  enumerable: true,
});
console.log(target.Promise === Promise, typeof target.Promise, Object.keys(target).join(","));
target.Promise = 5;
console.log(stored);

const holder = { impl: Promise };
console.log(holder.impl === Promise, typeof holder.impl);
new holder.impl((resolve) => resolve(7)).then((v) => console.log("construct", v));

function build(Impl) { return new Impl((resolve) => resolve("via argument")); }
build(Promise).then((v) => console.log(v));

const Q = Object.getPrototypeOf(Promise.resolve(1)).constructor;
console.log(Q === P, Q === holder.impl);

try { P.call(undefined, function () {}); } catch (e) { console.log(e.constructor.name, e.message); }
try { new P(); } catch (e) { console.log(e.constructor.name, e.message); }
try { new P(5); } catch (e) { console.log(e.constructor.name, e.message); }
console.log(String(P === globalThis.Promise));
