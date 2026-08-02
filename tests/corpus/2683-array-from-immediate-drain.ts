// `Array.from(m.values())` is the same IMMEDIATE drain as `[...m.values()]`:
// the iterator is made and consumed in one expression with no user code
// between, so the snapshot is exactly what JS observes. And `Array.from(a)`
// on an array is the shallow copy `a.slice()`.
//
// The two-argument form stays fenced on purpose and is NOT exercised here:
// `Array.from(it, f)` runs `f` per element DURING the drain, which can mutate
// the map and shift the very indices the snapshot walks.
const m = new Map<string, number>();
m.set("a", 1);
m.set("b", 2);
m.set("c", 3);

const vals = Array.from(m.values());
const keys = Array.from(m.keys());
console.log(vals.join(","), keys.join(","), vals.length);

// The spread spelling, which already worked: same answer.
console.log([...m.values()].join(","));

// A SET drains in insertion order, the same snapshot [...s] takes.
const s = new Set<string>(["x", "y"]);
console.log(Array.from(s).join(","));

// A plain array copies, and the copy is independent of the source.
const src = [1, 2, 3];
const copy = Array.from(src);
copy.push(4);
console.log(src.length, copy.length, copy.join(","));

// The drain is a SNAPSHOT: mutating the map afterwards leaves it alone.
const snap = Array.from(m.values());
m.set("d", 4);
console.log(snap.length, Array.from(m.values()).length);
