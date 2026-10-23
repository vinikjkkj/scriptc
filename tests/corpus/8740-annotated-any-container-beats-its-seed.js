// A seeded container whose declaration says `any` (JSDoc) is Node's own
// loosely typed container: the seed only fills it. `new Map([["a", 1]])`
// types as Map<string, number> by the seed alone, and a typed box built from
// that guess answered a TypeError (or refused the build) at the first store
// of another type, which Node accepts.
'use strict';

/** @type {Map<any, any>} */
const m = new Map([["a", 1]]);
m.set("b", "two");
m.set(3, { n: 3 });
m.set(null, [1, 2]);
console.log(m.size, m.get("a"), m.get("b"), m.get(3).n, m.get(null).length);
for (const [k, v] of m) console.log(typeof k, typeof v);

/** @type {Set<any>} */
const s = new Set([1, 2]);
s.add("x");
s.add(true);
s.add(2);
console.log(s.size, s.has("x"), s.has(true), s.has(1), s.has("1"));

// the annotation sits on a class field, the seed in the constructor
class Registry {
  constructor() {
    /** @type {Map<any, any>} */
    this.items = new Map([["first", 1]]);
  }
  put(k, v) { this.items.set(k, v); return this; }
}
const r = new Registry();
r.put("second", "2").put(3, false);
console.log(r.items.size, r.items.get("second"), r.items.get(3));

// SameValueZero over the values it carries
m.set(NaN, "nan");
m.set(-0, "zero");
console.log(m.get(NaN), m.get(0), m.has(+0));
