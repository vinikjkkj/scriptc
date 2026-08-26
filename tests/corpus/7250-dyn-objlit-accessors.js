// GET/SET accessors in a CHECKED-DYNAMIC object literal. The literal's
// contextual type is `any` (the JS declaration fallback), so it builds as a
// dyn object rather than a record — the road esbuild's module tables and
// lru.min's `createLRU` take. Each accessor becomes one `dyn.defineProp`
// carrying an ENUMERABLE, CONFIGURABLE descriptor, which is what the literal
// form creates and what Object.defineProperty does NOT default to.
'use strict';
function take(o) { return o; }

// A getter reads through the accessor and is NOT in the JSON as a stored
// value — it is called, once, at stringify time.
const one = take({ a: 1, get b() { return 2; }, c: 3 });
console.log(one.b);
console.log(JSON.stringify(one));
console.log(JSON.stringify(Object.keys(one)));
console.log(JSON.stringify(Object.values(one)));
console.log(JSON.stringify(Object.entries(one)));
console.log(JSON.stringify({ ...one }));
console.log(JSON.stringify(Object.assign({}, one)));

// Object.keys does NOT call the getter; every READ does.
let calls = 0;
const counted = take({ get n() { calls++; return calls; } });
console.log(JSON.stringify(Object.keys(counted)));
console.log(String(calls));
console.log(counted.n + " " + counted.n + " " + String(calls));

// get and set under the SAME key are ONE property, in either source order.
let v = 1;
const pair = take({ get k() { return v; }, set k(n) { v = n * 2; } });
console.log(String(pair.k));
pair.k = 5;
console.log(String(pair.k));
console.log(JSON.stringify(Object.keys(pair)));

let w = 1;
const rev = take({ set k(n) { w = n * 3; }, get k() { return w; } });
rev.k = 5;
console.log(String(rev.k));

// A SET-ONLY accessor reads as undefined, is still an own enumerable key,
// and JSON drops it for being undefined.
let seen = 0;
const setOnly = take({ a: 1, set s(/** @type {number} */ n) { seen = n; } });
setOnly.s = 7;
console.log(String(seen) + " " + String(setOnly.s));
console.log(JSON.stringify(Object.keys(setOnly)));
console.log(JSON.stringify(setOnly));

// Non-identifier keys, and `in`/hasOwnProperty/delete over the accessor.
const keys = take({ get 7() { return "seven"; }, get "a-b"() { return 9; } });
console.log(keys[7] + " " + keys["a-b"]);
console.log(JSON.stringify(Object.keys(keys)));
console.log(String("a-b" in keys) + " " + String(Object.prototype.hasOwnProperty.call(keys, 7)));
console.log(String(delete keys["a-b"]) + " " + JSON.stringify(Object.keys(keys)));
