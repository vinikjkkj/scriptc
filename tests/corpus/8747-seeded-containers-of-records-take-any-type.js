// A seeded container whose VALUES are records. The inferred type
// (Map<string, {n: number}>) is a guess like any other: untyped code stores a
// string or a number, and the typed box threw. The container is the
// dyn-flavoured box, and what is stored keeps its identity: a literal-
// initialised binding handed to it is the dyn value itself, so a later
// mutation shows through the container exactly as in Node.
'use strict';

function put(m, k, v) { m.set(k, v); }

const m = new Map([["a", { n: 1 }]]);
put(m, "b", "str");
put(m, "c", 5);
console.log(m.size, m.get("a").n, m.get("b"), m.get("c"));

const o = { n: 1 };
m.set("o", o);
o.n = 2;
console.log(m.get("o").n);
m.get("a").n = 9;
console.log(m.get("a").n);

function mkrec(i) { return { n: i }; }
const r = mkrec(4);
m.set("r", r);
r.n = 5;
console.log(m.get("r").n);
