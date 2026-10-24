"use strict";
// The module-level cache every JavaScript package keeps: `const cache = new Map()` at file
// scope, read and written by hoisted function declarations. The container's uses either fix
// its key and value types (a typed Map) or leave it untyped (a dyn-flavored Map); a WeakMap
// or WeakSet is always untyped. All of them are one binding the functions share.
const byName = new Map();
byName.set("zero", 0);
function lookup(name) {
  return byName.has(name) ? byName.get(name) : -1;
}
function remember(name, n) {
  byName.set(name, n);
  return byName.size;
}

const anything = new Map();
function put(key, value) {
  anything.set(key, value);
  return anything.size;
}
function take(key) {
  const v = anything.get(key);
  anything.delete(key);
  return v;
}

const seen = new Set();
function once(x) {
  if (seen.has(x)) return "again";
  seen.add(x);
  return "first";
}

const owners = new WeakMap();
function claim(obj, who) {
  if (owners.has(obj)) return owners.get(obj);
  owners.set(obj, who);
  return who;
}

const marked = new WeakSet();
function mark(obj) {
  const had = marked.has(obj);
  marked.add(obj);
  return had;
}

class Conn { constructor(id) { this.id = id; } }
const a = new Conn(1), b = new Conn(2);
console.log(lookup("zero"), lookup("one"), remember("one", 1), lookup("one"));
console.log(put("k", { n: 1 }).toString(), put(7, [1, 2]), put(a, "conn-a"), take("k").n, take(a), take(a), anything.size);
console.log(once("x"), once("x"), once(3), once(3), once("3"));
console.log(claim(a, "first"), claim(a, "second"), claim(b, "third"), claim({}, "x"));
console.log(mark(a), mark(a), mark(b), mark({}));
