// A Set whose element type is a union: elements compare by SameValueZero over
// the arm they carry (strings by content, numbers with -0 == 0 and NaN == NaN,
// bigints by value, booleans, null and undefined by kind, every object arm by
// identity), keep insertion order, and survive delete/clear/forEach/spread.
type V = string | number | boolean | bigint | null | undefined | number[] | Set<V>;
const s = new Set<V>();
s.add("a"); s.add("a"); s.add(1); s.add(1); s.add(0); s.add(-0); s.add(NaN); s.add(NaN);
s.add(true); s.add(true); s.add(false); s.add(null); s.add(null); s.add(undefined); s.add(undefined);
s.add(5n); s.add(5n); s.add(-5n); s.add(6n);
const arr = [1, 2];
s.add(arr); s.add(arr); s.add([1, 2]);
s.add("1"); s.add(String(1));
console.log(s.size);
console.log(s.has("a"), s.has("b"), s.has(1), s.has("1"), s.has(0), s.has(-0), s.has(NaN), s.has(true), s.has(false), s.has(null), s.has(undefined));
console.log(s.has(5n), s.has(-5n), s.has(7n), s.has(arr), s.has([1, 2]));
let out = "";
for (const x of s) out += (typeof x) + ":" + (typeof x === "object" ? (x === null ? "null" : Array.isArray(x) ? "arr" : "set") : String(x)) + " ";
console.log(out);
console.log(s.delete("a"), s.delete("a"), s.delete(5n), s.size, s.has(5n), s.has(6n));
const inner = new Set<V>([1, "x"]);
s.add(inner); s.add(inner);
console.log(s.size, s.has(inner), s.has(new Set<V>([1, "x"])));
const seeded = new Set<V>([1, "1", 1, "1", 2, null, null]);
console.log(seeded.size, [...seeded].length);
let cnt = 0; seeded.forEach(() => { cnt++; });
console.log(cnt);
seeded.clear();
console.log(seeded.size);

const mixed = new Set<string | number>(["a", 1, "a", 1, 2]);
console.log(mixed.size, mixed.has(1), mixed.has("1"), [...mixed].join(","));
