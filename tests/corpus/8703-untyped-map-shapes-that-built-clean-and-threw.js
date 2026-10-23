// The program that started this: each of these shapes BUILT CLEAN and then
// answered `TypeError: map.set is not a function` (or `m.size` undefined)
// where Node answers a value. A silent divergence is the worst class a
// compiler can have, so every shape is pinned against Node on both backends.
'use strict';

// the reduction
function f(k, v) {
  const map = new Map();
  map.set(k, v);
  return map.get(k);
}
console.log(f("a", 1));
function g(keys) {
  const m = new Map();
  for (const k of keys) m.set(k, k + "!");
  return m.size;
}
console.log(g(["a", "b"]));

// size only, never written
function emptySize() {
  const m = new Map();
  return m.size;
}
console.log(emptySize());

// never touched: identity, typeof, instanceof
const untouched = new Map();
console.log(typeof untouched, untouched instanceof Map, untouched.size);

// a Set with no element type used to be refused at build
function dedupe(xs) {
  const s = new Set();
  for (const x of xs) s.add(x);
  return s.size + ":" + s.has(xs[0]);
}
console.log(dedupe(["a", "a", "b"]));

// chained set() returns the map
function chain(a, b) {
  const m = new Map();
  m.set(a, 1).set(b, 2);
  return m.size;
}
console.log(chain("x", "y"));

// a Map handed to another function and returned from one
function fill(m, k, v) { m.set(k, v); }
function make() { return new Map(); }
const passed = make();
fill(passed, "a", 1);
console.log(passed.get("a"), passed.size);

// for...of over the entries
function sum(keys) {
  const m = new Map();
  for (const k of keys) m.set(k, 1);
  let n = 0;
  for (const [, v] of m) n += v;
  return n;
}
console.log(sum(["a", "b", "a"]));

// a Map and a WeakMap in object fields
const holder = { m: new Map(), w: new WeakMap() };
const key = {};
holder.m.set(1, 2);
holder.w.set(key, 3);
console.log(holder.m.get(1), holder.w.get(key));
