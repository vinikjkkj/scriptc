'use strict';
// A record read and written through untyped (dynamic) parameters must stay coherent with the named static record in both directions: a static write shows through a later dynamic read, a dynamic write shows through a later static read, and a key the record type does not declare survives across crossings.
function mk() { return { len: 2, name: 'a', ok: false }; }
function pass(x) { return x; }
function setLen(env) { env.len = 7; return env.len; }
function readLen(env) { return env.len; }
function setName(env) { env.name = 'z'; }
function setOk(env) { env.ok = true; }
function tag(env) { env.extra = 9; }
function readExtra(env) { return env.extra; }
const r = mk();
console.log(readLen(pass(r)));
r.len = 5;
console.log(readLen(pass(r)));
console.log(setLen(pass(r)), r.len);
setName(pass(r));
console.log(r.name);
setOk(pass(r));
console.log(r.ok);
tag(pass(r));
console.log(readExtra(pass(r)));
r.len = 11;
console.log(readLen(pass(r)), readExtra(pass(r)));
