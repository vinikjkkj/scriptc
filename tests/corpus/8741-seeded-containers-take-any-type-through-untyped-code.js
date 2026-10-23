// The container's element types are inferred from an unannotated seed:
// `new Map([["a", 1]])` is Map<string, number>, `new Set([1])` is Set<number>.
// Node does not enforce that guess, and untyped code stores whatever it has.
// A typed box has static slots and typed readers; a store of another type had
// nowhere to land and answered a TypeError. These containers reach untyped
// code (a bare reference to an untyped parameter), so they are built as the
// dyn-flavoured box and keep every entry Node keeps.
'use strict';

function put(m, k, v) { m.set(k, v); return m; }
function get(m, k) { return m.get(k); }
function add(s, v) { s.add(v); return s; }

const m = new Map([["a", 1], ["b", 2]]);
put(m, "c", "three");
put(m, 4, { four: 4 });
put(m, "a", [1]);
console.log(m.size, get(m, "a"), get(m, "b"), get(m, "c"), get(m, 4).four, get(m, 5));
for (const [k, v] of m) console.log(k, v);
console.log([...m.keys()], m.has(4), m.has("4"));

const s = new Set([1, 2, 3]);
add(s, "x");
add(s, 2);
add(s, null);
console.log(s.size, s.has("x"), s.has(null), s.has("2"), [...s]);

const flags = new Map([[1, true], [2, false]]);
put(flags, 3, "maybe");
console.log(flags.size, flags.get(3), flags.get(1));

// delete and clear still work through the same box
console.log(m.delete("c"), m.delete("c"), m.size);
s.clear();
console.log(s.size);

// a mismatching store made directly, in the same file
const direct = new Map([["k", 1]]);
direct.set("j", "str");
direct.set(7, true);
console.log(direct.size, direct.get("j"), direct.get(7), direct.get("k") + 1);
const ds = new Set(["a"]);
ds.add(1);
ds.add(false);
console.log(ds.size, ds.has(1), ds.has(false), ds.has("a"));
