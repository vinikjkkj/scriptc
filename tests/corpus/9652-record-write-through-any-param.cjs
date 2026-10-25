'use strict';
// A dynamic parameter writes a property onto a record it received: the write must land on the object the caller holds, so the caller and a later read through the parameter both see it.
function make() { return { first: 1 }; }
const obj = make();
function wrap(env) { env.extra = 42; return env.extra + env.first; }
console.log(wrap(obj));
