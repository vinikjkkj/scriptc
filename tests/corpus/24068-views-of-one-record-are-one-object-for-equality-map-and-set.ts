// Views of one record are one object: === , Map and Set keys and indexOf see JavaScript's single identity; a different record is a different key.
interface Wide { name: string; n: number; extra: number }
interface Narrow { n: number }
const w: Wide = { name: "w", n: 1, extra: 2 };
const a: Narrow = w;
const b: Narrow = w;
console.log(a === b, a !== b);
const m = new Map<Narrow, string>();
m.set(a, "first");
console.log(m.get(b), m.get(w), m.size);
const s = new Set<Narrow>([a, b, w]);
console.log(s.size, s.has(w), s.has(b));
const other: Wide = { name: "o", n: 1, extra: 2 };
const c: Narrow = other;
console.log(a === c, new Set<Narrow>([a, c]).size);
const same: Narrow[] = [a, b];
console.log(same.indexOf(b));
