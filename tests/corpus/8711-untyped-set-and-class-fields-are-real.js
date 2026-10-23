// The Set half of 8710: a JAVASCRIPT `new Set()` with no element type is a
// dyn-flavored Set (SameValueZero over dyn values), as are Map/Set fields
// assigned in a constructor (`this.map = new Map()` used to be refused at
// build because a dyn slot carried no method table). Includes the seeded
// constructors and the TypeErrors a bad seed or callback throws.
'use strict';

// untyped Set
function mk() { return new Set(); }
function add(s, x) { s.add(x); return s; }
const s = mk();
add(s, 1); add(s, "1"); add(s, NaN); add(s, NaN); add(s, -0); add(s, 0); add(s, null); add(s, undefined);
console.log(s.size, s.has(1), s.has("1"), s.has(NaN), s.has(0), s.has(-0), s.has(null), s.has(undefined), s.has(2));
const o = {}, a = [];
add(s, o); add(s, a); add(s, {}); add(s, []);
console.log(s.size, s.has(o), s.has({}), s.has(a));
console.log(s.add(5) === s, s.delete(5), s.delete(5), s.size);
s.clear(); console.log(s.size);
const t = mk(); t.add("b"); t.add("a"); t.add("b");
const out = []; t.forEach((v, k, self) => { out.push(v + ":" + k + ":" + (self === t)); }); console.log(out.join(","));
for (const x of t) console.log("of", x);
console.log([...t], [...t.values()], [...t.keys()], [...t.entries()]);
console.log(Array.from(t.values()).length);
const seeded = new Set(["x", "y", "x"]);
function sd(xs) { return new Set(xs); }
const s2 = sd(["p", "q", "p", 1, 1]); console.log(s2.size, s2.has("p"), s2.has(1));
const s3 = sd("hello"); console.log(s3.size, s3.has("l"));
console.log(typeof s, s instanceof Set, s instanceof Map, Object.prototype.toString.call(s), JSON.stringify(s), String(s));
console.log(t);
console.log(mk());
const big = mk(); for (let i = 0; i < 120; i++) add(big, i);
console.log(big.size);
console.log(big);
const nested = mk(); const inner = mk(); inner.add(1); nested.add(inner); nested.add({ a: [1, { b: inner }] });
console.log(nested);
// Map whose values are sets and maps
const mm = new Map(); function mput(m, k, v) { m.set(k, v); }
mput(mm, "s", t); mput(mm, "m", mk()); console.log(mm.get("s") === t, mm.size);
// class fields
class Reg {
  constructor() { this.map = new Map(); this.set = new Set(); }
  add(k, v) { this.map.set(k, v); this.set.add(k); return this; }
  get(k) { return this.map.get(k); }
  keys() { return [...this.map.keys()]; }
  count() { return this.map.size + this.set.size; }
}
const r = new Reg(); r.add("a", 1).add("b", 2).add("a", 3);
console.log(r.get("a"), r.keys(), r.count());
// errors
try { new Map([1]); } catch (e) { console.log(e.name, e.message); }
try { new Map(5); } catch (e) { console.log(e.name, e.message); }
try { mk().forEach(5); } catch (e) { console.log(e.name, e.message); }
