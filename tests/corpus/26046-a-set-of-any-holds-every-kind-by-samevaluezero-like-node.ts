// Set<any> / Set<unknown> / a bare new Set() hold values of any kind by SameValueZero, through bindings, parameters, returns and fields.
const s = new Set<any>();
s.add(1); s.add("a"); s.add(1); s.add(null); s.add(undefined); s.add(NaN); s.add(NaN); s.add(0); s.add(-0); s.add("1");
const o = { k: 1 };
s.add(o); s.add(o); s.add({ k: 1 });
console.log(s.size, s.has("a"), s.has(2), s.has(o), s.has({ k: 1 }), s.has(null), s.has(NaN), s.has(-0), s.has("1"));
for (const v of s) console.log(typeof v);
s.delete(1); console.log(s.size);
const d: any = JSON.parse('[1,2,2,3]');
const t = new Set<any>(d);
console.log(t.size, [...t].join());
const u = new Set();
u.add("x"); u.add(2);
console.log(u.size, u.has("x"));
const w: Set<unknown> = new Set<unknown>();
w.add(1); w.add("1");
console.log(w.size);
s.forEach((v) => console.log(String(v)));
s.clear(); console.log(s.size);
function fill(set: Set<any>, ...xs: any[]) { for (const x of xs) set.add(x); return set; }
function mk(): Set<any> { return new Set<any>(); }
class Reg { items = new Set<any>(); add(x: any) { this.items.add(x); return this.items.size; } }
const r = new Reg();
console.log(r.add(1), r.add("a"), r.add(1));
console.log(fill(mk(), 1, 2, 2, "3").size);
