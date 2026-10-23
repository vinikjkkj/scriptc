// keys() / values() / entries() on a receiver the compiler cannot type
// (an `any` parameter), drained where they are made: a for-of subject, a
// spread element, the sole argument of Array.from or of new Map / new Set.
// The runtime drains an array, a typed array, a Map or a Set (typed or not)
// into a snapshot, which is exactly what the live iterator would produce
// when it is consumed at once. Before, every one of these refused to build.
'use strict';

// keys()/values()/entries() on an untyped receiver, drained where they are made
function all(a) {
  const out = [];
  for (const [i, x] of a.entries()) out.push(i + ":" + x);
  for (const k of a.keys()) out.push("k" + k);
  for (const v of a.values()) out.push("v" + v);
  return [...a.values()].length + "|" + out.join(",") + "|" + Array.from(a.keys()).join("");
}
console.log(all([5, 6, 7]));
console.log(all(new Uint8Array([1, 2])));
console.log(all(new Map([["a", 1]])));
console.log(all(new Set([9, 8])));
function mk() { return new Map(); }
const m = mk(); m.set("p", 1); m.set("q", 2);
console.log(all(m));
const s = new Set(all(m).split("|"));
console.log(s.size);
console.log(new Map(m.entries()).size, new Set(m.keys()).size);
console.log(all([]));
