// A TYPED Map or Set (`new Map([["a", 1]])`, a JSDoc-annotated container)
// handed to untyped code: the box is the SAME map, and the dyn side drives
// its static slots through the conversion table the box carries. It used to
// answer `TypeError: m.get is not a function` for every method Node has,
// and `size` / inspect refused. A probe that does not fit the key type is a
// miss, exactly as Map.prototype.get answers for a key that is not there.
'use strict';

// typed Maps and Sets reached through untyped code
function get(m, k) { return m.get(k); }
function put(m, k, v) { m.set(k, v); return m; }
function size(m) { return m.size; }
function has(m, k) { return m.has(k); }
function del(m, k) { return m.delete(k); }
function each(m, f) { m.forEach(f); }
function add(s, x) { s.add(x); return s; }

const sn = new Map([["a", 1], ["b", 2]]);
console.log(get(sn, "a"), get(sn, "zz"), get(sn, 1), get(sn, undefined), size(sn), has(sn, "b"), has(sn, 2));
put(sn, "c", 3); console.log(sn.size, sn.get("c"), size(sn));   // written through dyn, read back typed
put(sn, "a", 10); console.log(sn.get("a"));
console.log(del(sn, "b"), del(sn, "b"), del(sn, 5), sn.size);
const log = [];
each(sn, (v, k, m) => { log.push(k + "=" + v); });
console.log(log.join(","));

const ns = new Map([[1, "one"], [2, "two"]]);
console.log(get(ns, 1), get(ns, 2), get(ns, "1"), get(ns, 3), has(ns, -0 + 1));
put(ns, -0, "zero"); console.log(get(ns, 0), get(ns, -0), size(ns));
put(ns, NaN, "nan"); console.log(get(ns, NaN), size(ns));

const sets = new Set(["x", "y"]);
console.log(has(sets, "x"), has(sets, "q"), has(sets, 5), size(sets));
add(sets, "z"); console.log(sets.size, sets.has("z"));
console.log(del(sets, "x"), sets.size);
const setn = new Set([1, 2, 3]);
add(setn, 2); add(setn, 4); console.log(setn.size, has(setn, 4), has(setn, "4"));

// iteration, spread, destructuring, for-of on a boxed typed map
function iter(m) { const out = []; for (const e of m) out.push(e[0] + ":" + e[1]); return out.join(","); }
console.log(iter(sn), iter(ns));
function spread(m) { return JSON.stringify([...m]); }
console.log(spread(sn), spread(sets), spread(setn));
function kv(m) { return [...m.keys()].join("|") + "/" + [...m.values()].join("|"); }
console.log(kv(sn), kv(ns));
function ent(m) { const out = []; for (const [k, v] of m.entries()) out.push(k + v); return out.join(","); }
console.log(ent(sn));
function af(m) { return Array.from(m.values()).length; }
console.log(af(sn), af(setn));

// the box is the SAME map: identity and aliasing
function same(a, b) { return a === b; }
console.log(same(sn, sn), same(sn, new Map()));

// values that are arrays, records, nested maps
const arrs = new Map([["xs", [1, 2, 3]], ["ys", [4]]]);
console.log(get(arrs, "xs"), get(arrs, "ys").length, get(arrs, "none"));
put(arrs, "zs", [9, 9]); console.log(arrs.get("zs"), arrs.size);
const recs = new Map([["r", { a: 1, b: "x" }]]);
console.log(get(recs, "r"), get(recs, "r").b);
const nested = new Map([["inner", new Map([["k", 1]])]]);
console.log(get(nested, "inner").get("k"), get(nested, "inner").size);

// inspect of typed boxes, alone and nested in an untyped container
function show(x) { console.log(x); }
show(sn); show(ns); show(sets); show(setn); show(arrs); show(recs); show(nested);
const holder = [];
holder.push(sn); holder.push(sets);
console.log(holder);

