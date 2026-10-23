// The narrowest form of the defect: nothing in this file stores a foreign
// type STATICALLY. The container is seeded, so its inferred type is
// Map<string, number> / Set<number>, and the only stores of another type go
// through untyped helpers. The typed box answered
// `TypeError: expected number at $, got string` at the first of them; Node
// stores the value.
'use strict';

function put(m, k, v) { m.set(k, v); }
function get(m, k) { return m.get(k); }
function add(s, v) { s.add(v); }
function has(s, v) { return s.has(v); }
function size(c) { return c.size; }

const m = new Map([["a", 1]]);
put(m, "b", "x");
put(m, "c", {});
console.log(size(m), get(m, "a"), get(m, "b"));

const s = new Set([1]);
add(s, "x");
console.log(size(s), has(s, 1), has(s, "x"));
