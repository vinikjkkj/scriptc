// The Map/Set paths that only a SIZED map reaches: bucket-table rebuilds,
// the dense entries array outgrowing its capacity, tombstones accumulating
// until compaction moves live entries down, and an iteration running while
// the callback mutates the map underneath it.
//
// Small maps never reach any of them. scr_map.c grows its bucket table on
// `nbuckets < 2 * (nentries + 1)` starting at 16, and its entries array by
// doubling from 8, so the counts below are chosen to cross both thresholds
// several times: 30,000 inserts rebuild the bucket table twelve times.
// Compaction only runs when tombstones are at least half the dense entries,
// which needs a delete pass over a map that is already large.
//
// Node is the oracle, so every line printed here is a claim about
// JS-observable behaviour: insertion order, Map.size across deletes and
// re-inserts, what forEach visits when the callback deletes and adds, and
// that a key deleted and re-added moves to the END of the iteration order.

const N = 30000;

// ── growth: string keys, insertion order preserved across many rebuilds ──
const m = new Map<string, number>();
for (let i = 0; i < N; i++) m.set("k" + i, i * 3);
console.log("size after fill:", m.size);

let sum = 0;
let order = 0;
let idx = 0;
m.forEach((v, k) => {
  sum += v;
  if (k !== "k" + idx) order++;
  idx++;
});
console.log("sum:", sum, "out-of-order keys:", order);

// ── tombstones and compaction ────────────────────────────────────────────
// Reaching compaction takes more than deleting a lot. scr_map_reserve_append
// returns early while the dense array still has room, so tombstones are only
// collected when nentries actually hits ecap AND at least half of them are
// dead. With N = 30000 the entries array is 32768 wide, so deleting two keys
// in every three (nlive 10000 of 30000 dense) and then appending 3000 more
// crosses 32768 while nlive is still under half — which is the only way this
// program walks scr_map_compact at all. Chosen by counting, not by hoping:
// at N = 20000 and 5000 appended, the earlier shape of this test, the dense
// array never filled and compaction never ran once.
for (let i = 0; i < N; i++) {
  if (i % 3 !== 0) m.delete("k" + i);
}
console.log("size after delete pass:", m.size);
console.log("deleted key present:", m.has("k1"), "kept key present:", m.has("k0"));
console.log("get on a tombstone:", m.get("k1"), "get on a live key:", m.get("k3"));

// Appending past the tombstones is what triggers compaction, and compaction
// must renumber the dense indices without changing what iteration sees.
for (let i = N; i < N + 3000; i++) m.set("k" + i, i * 3);
console.log("size after regrow:", m.size);

let first = "";
let last = "";
let count = 0;
m.forEach((_v, k) => {
  if (count === 0) first = k;
  last = k;
  count++;
});
console.log("iteration count:", count, "first:", first, "last:", last);

// A key deleted and re-added is a NEW insertion and goes to the end.
m.delete("k0");
m.set("k0", -1);
let tail = "";
m.forEach((_v, k) => {
  tail = k;
});
console.log("re-added key is last:", tail, m.get("k0"));

// ── mutation during iteration: indices must stay stable ─────────────────
// The dense array cannot be compacted while an iteration is live, and
// entries appended by the callback ARE visited (Node-exact).
const mm = new Map<string, number>();
for (let i = 0; i < 8; i++) mm.set("a" + i, i);
const seen: string[] = [];
mm.forEach((_v, k) => {
  seen.push(k);
  if (k === "a0") {
    mm.delete("a3");
    mm.set("a8", 8);
  }
  if (k === "a8") mm.set("a9", 9);
});
console.log("visited during mutation:", seen.join(","));
console.log("size after mutation:", mm.size);

// ── clear and refill: the bucket table is reset, capacity is not ─────────
m.clear();
console.log("size after clear:", m.size, "has after clear:", m.has("k0"));
for (let i = 0; i < 100; i++) m.set("z" + i, i);
console.log("size after refill:", m.size, "get z99:", m.get("z99"), "get k0:", m.get("k0"));

// ── number keys take the other key kind through the same arrays ──────────
const nm = new Map<number, string>();
for (let i = 0; i < N; i++) nm.set(i, "v" + i);
for (let i = 0; i < N; i++) {
  if (i % 3 !== 0) nm.delete(i);
}
for (let i = N; i < N + 3000; i++) nm.set(i, "v" + i);
let nsum = 0;
nm.forEach((_v, k) => {
  nsum += k;
});
console.log("number-key size:", nm.size, "key sum:", nsum, "get 1:", nm.get(1), "get 0:", nm.get(0));

// ── a Set stores its elements as keys, so it walks the same code ─────────
const s = new Set<string>();
for (let i = 0; i < N; i++) s.add("s" + i);
for (let i = 0; i < N; i++) {
  if (i % 3 !== 0) s.delete("s" + i);
}
for (let i = N; i < N + 3000; i++) s.add("s" + i);
let ssum = 0;
s.forEach((v) => {
  ssum += v.length;
});
console.log("set size:", s.size, "length sum:", ssum, "has s0:", s.has("s0"), "has s1:", s.has("s1"));

// ── spread and Array.from read the dense array directly ──────────────────
const small = new Map<string, number>();
for (let i = 0; i < 12; i++) small.set("p" + i, i);
for (let i = 0; i < 12; i += 4) small.delete("p" + i);
console.log("keys:", [...small.keys()].join(","));
console.log("values:", [...small.values()].join(","));
console.log("entries:", JSON.stringify([...small.entries()]));
