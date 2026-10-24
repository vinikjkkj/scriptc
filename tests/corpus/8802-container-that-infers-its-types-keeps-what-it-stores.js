// A `const m = new Map()` whose uses fix one key type and one value type is
// compiled as a typed container, and the program that stores a local array
// or object in it keeps ONE identity: a mutation after the store is visible
// through the container and the other way round. The binding used to be
// pinned to an untyped value while the container stayed typed, so the store
// was a copy (`m.get("xs").length` answered 2 where Node answers 3).
'use strict';

function arrays() {
  const m = new Map();
  const xs = [1, 2];
  m.set("xs", xs);
  xs.push(3);
  console.log(m.get("xs").length);
}
arrays();

function objects() {
  const m = new Map();
  const r = { n: 1 };
  m.set("r", r);
  r.n = 2;
  console.log(m.get("r").n);
}
objects();

function sets() {
  const s = new Set();
  const r = { n: 1 };
  s.add(r);
  r.n = 2;
  for (const v of s) console.log(v.n);
}
sets();

const fileScope = new Map();
const kept = [10, 20];
fileScope.set("kept", kept);
kept.push(30);
console.log(fileScope.get("kept").length);
