// `this` inside a dyn object literal's accessor is the RECEIVER the property
// is read through — the runtime pushes it around the call, and `this` in a
// plain JS function is exactly that ambient read. A METHOD of the same object
// keeps its fence; an ACCESSOR does not need one.
'use strict';
function take(o) { return o; }

const self = take({ a: 5, get plus() { return this.a + 1; } });
console.log(String(self.plus));
self.a = 40;
console.log(String(self.plus));

// A throwing getter unwinds through every surface that calls it.
const bad = take({ a: 1, get boom() { throw new Error("from the getter"); } });
try { console.log(String(bad.boom)); } catch (e) { console.log("read: " + e.message); }
try { console.log(JSON.stringify(bad)); } catch (e) { console.log("json: " + e.message); }

// A throwing setter, and a setter reached through an alias.
const badSet = take({ set s(/** @type {number} */ n) { throw new Error("no " + n); } });
try { badSet.s = 3; } catch (e) { console.log("write: " + e.message); }

let stored = 0;
const aliased = take({ get s() { return stored; }, set s(n) { stored = n; } });
const alias = aliased;
alias.s = 11;
console.log(String(aliased.s));

// Source ORDER: data members evaluate where they are written, accessor
// definitions evaluate nothing, and the key order is the literal's.
let log = "";
function step(n) { log += n; return n; }
const ordered = take({ x: step(1), get y() { return step(2); }, z: step(3) });
console.log(log);
console.log(JSON.stringify(Object.keys(ordered)));
console.log(String(ordered.y));
console.log(log);

// A getter returning a fresh object, a function, and undefined.
const shapes = take({
  get obj() { return { q: 1 }; },
  get fn() { return function () { return 5; }; },
  get nothing() { return undefined; },
});
console.log(JSON.stringify(shapes.obj));
console.log(String(shapes.fn()));
console.log(JSON.stringify(shapes));
