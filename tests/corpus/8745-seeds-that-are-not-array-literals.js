// The seed is a value, not a literal: an array variable, Object.entries, a
// string, another container. The type arguments are still inferred from it,
// and the container still takes another type from untyped code.
'use strict';

function put(m, k, v) { m.set(k, v); }
function add(s, v) { s.add(v); }

const pairs = [["a", 1], ["b", 2]];
const m1 = new Map(pairs);
put(m1, "c", "three");
console.log(m1.size, m1.get("c"), pairs.length);

const nums = [3, 1, 2, 3];
const s1 = new Set(nums);
add(s1, "x");
console.log(s1.size, s1.has("x"), nums.length);

const m2 = new Map(Object.entries({ p: 1, q: 2 }));
put(m2, "r", null);
console.log(m2.size, m2.get("r"), m2.get("p"));

const m3 = new Map(m1);
put(m3, 5, 6);
console.log(m3.size, m3.get(5), m1.size, m1.has(5));

const s2 = new Set("hello");
add(s2, 1);
console.log(s2.size, s2.has("l"), s2.has(1));
