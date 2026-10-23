// A JAVASCRIPT `new Map()` whose type arguments never resolve past
// `Map<any, any>` (no annotation, no contextual type, no use that fixes one)
// has no static key or value type, so it is a dyn-flavored container: keys
// and values are dyn boxes and the keys compare by SameValueZero over the
// value they carry. It used to lower to an opaque dyn OBJECT with no member
// table: the build was clean and `m.set(k, v)` answered
// `TypeError: m.set is not a function` at run time, where Node answers a
// value. Every Map method, the iteration forms and the inspect rendering are
// pinned here against Node.
'use strict';

// untyped Map / Set: every method, SameValueZero, order, live forEach, iteration, inspect
function mk() { return new Map(); }
function put(m, k, v) { m.set(k, v); return m; }
const m = mk();
put(m, "a", 1); put(m, 2, "two"); put(m, true, null); put(m, undefined, "u"); put(m, null, "n");
console.log(m.size, m.get("a"), m.get(2), m.get(true), m.get(undefined), m.get(null), m.get("2"), m.get(3));
console.log(m.has("a"), m.has("zz"), m.has(undefined), m.has(null), m.has(false));
// SameValueZero: NaN equals NaN, -0 is +0
put(m, NaN, "nan"); put(m, -0, "zero");
console.log(m.get(NaN), m.get(0), m.get(-0), m.size);
put(m, 0, "zero2"); console.log(m.get(-0), m.size);
// objects and arrays key by identity
const o1 = {}, o2 = {}, a1 = [1], a2 = [1];
put(m, o1, "o1"); put(m, a1, "a1");
console.log(m.get(o1), m.get(o2), m.get(a1), m.get(a2), m.has(o2));
// set returns the map: chaining
const c = mk();
console.log(c.set("x", 1).set("y", 2).set("x", 3).size, c.get("x"));
// delete, clear
console.log(c.delete("x"), c.delete("x"), c.size, c.has("x"));
c.clear(); console.log(c.size, c.get("y"));
// string keys by content
const k1 = "ab" + "c", k2 = "a" + "bc";
const sm = mk(); sm.set(k1, 1); console.log(sm.get(k2), sm.get("abc"));
// functions as keys
const f = () => 1, g = () => 1;
const fm = mk(); fm.set(f, "f"); console.log(fm.get(f), fm.get(g));
// insertion order, re-set keeps position
const om = mk(); om.set("b", 1); om.set("a", 2); om.set("b", 3);
const seen = []; om.forEach((v, k) => seen.push(k + "=" + v)); console.log(seen.join(","));
// forEach is live: appended entries are visited, deleted are skipped
const lm = mk(); lm.set(1, "a"); lm.set(2, "b"); lm.set(3, "c");
const trace = [];
lm.forEach((v, k, self) => { trace.push(k); if (k === 1) { self.delete(2); self.set(4, "d"); } });
console.log(trace.join(","), self_check(lm));
function self_check(mm) { return mm.size; }
// forEach thisArg and the 3rd arg
const tm = mk(); tm.set("q", 9);
tm.forEach(function (v, k, mp) { console.log(this.tag, v, k, mp === tm); }, { tag: "T" });
// for...of / spread / destructuring over entries
const em = mk(); em.set("p", 1); em.set("q", 2);
for (const [k, v] of em) console.log("of", k, v);
console.log([...em].length, JSON.stringify([...em]));
const [first] = em; console.log(first);
// keys / values / entries drained
console.log([...em.keys()], [...em.values()], [...em.entries()]);
for (const k of em.keys()) console.log("k", k);
console.log(Array.from(em.values()));
// seeded construction
const sd = new Map([["s", 1], ["t", 2]]);
console.log(sd.size, sd.get("t"));
function seeded(entries) { return new Map(entries); }
const sm2 = seeded([["a", 1], ["b", 2]]); console.log(sm2.size, sm2.get("b"));
const cp = new Map(sm2); cp.set("z", 0); console.log(cp.size, sm2.size);
// typeof / instanceof / toString / JSON
console.log(typeof m, m instanceof Map, Object.prototype.toString.call(m), JSON.stringify(m), String(m));
// inspect
const im = mk(); im.set("a", 1); im.set({ x: 1 }, [1, 2]); const inner = mk(); inner.set("n", 1); im.set(3, inner);
console.log(im);
console.log(mk());
console.log(mk());
