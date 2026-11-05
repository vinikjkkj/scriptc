// Tagged maps and sets freed in bulk, kept and untagged all behave as Node; defineProperty hides one from inspect.
"use strict";
const k = Symbol("k");
function tag(o, v) { o[k] = v; return o; }
function get(o) { return o[k]; }
const keep = [];
let sum = 0;
for (let i = 0; i < 20000; i++) {
  const m = tag(i % 2 ? new Map([[i, i]]) : new Set([i]), { i });
  if (i % 7 === 0) keep.push(m);
  sum += get(m).i;
}
let live = 0;
for (const m of keep) { live += get(m).i; delete m[k]; }
console.log(sum, live, keep.length, keep.every((m) => get(m) === undefined));
const s1 = new Set(); tag(s1, 1); console.log(get(s1), Reflect.ownKeys(s1).length);
Object.defineProperty(s1, k, { value: 5, enumerable: false });
console.log(get(s1), s1);
