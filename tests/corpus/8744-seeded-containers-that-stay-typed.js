// The other half of the seed pin: containers nothing can store a foreign type
// into stay typed boxes, and behave exactly as before. Each one here is
// const-bound and every reference is a member operation with arguments of the
// inferred types, a for-of, a spread, a typeof, a stdlib sink that cannot
// store into it, or an argument to a function that only reads it. The last
// two cases are annotated typed sinks.
'use strict';

const m = new Map([["a", 1], ["b", 2]]);
m.set("c", 3);
let total = 0;
for (const [k, v] of m) total += v;
function sum(mm) { let t = 0; for (const v of mm.values()) t += v; return t + mm.size; }
console.log(total, sum(m), m.has("c"), m.get("zz"), [...m.keys()], typeof m);
console.log(m);

const counts = new Map([["x", 0]]);
for (let i = 0; i < 10; i++) {
  const k = i % 2 ? "x" : "y";
  counts.set(k, (counts.get(k) || 0) + 1);
}
console.log(counts.get("x"), counts.get("y"), Array.from(counts.entries()));

const s = new Set([1, 2, 3]);
s.add(4);
s.add(2);
console.log(s.size, s.has(4), [...s], JSON.stringify([...s]));

// an annotated typed sink: the author asserted the type, so the box stays
// typed even though an untyped helper also holds it
/** @param {Map<string, number>} y */
function typed(y) { let t = 0; for (const v of y.values()) t += v; return t; }
const both = new Map([["a", 1]]);
function put(mm, k, v) { mm.set(k, v); }
put(both, "b", 2);
console.log(typed(both), both.size);

/** @type {Map<string, number>} */
const annotated = new Map([["a", 1]]);
annotated.set("b", 2);
put(annotated, "c", 3);
console.log(annotated.size, annotated.get("c"), typed(annotated));
