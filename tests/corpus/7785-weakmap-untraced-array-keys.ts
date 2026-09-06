// WeakMap keyed by an UNTRACED array — the shape zapo-js 1.8.2 uses at
// transport/binary/decoder.ts:87, `WeakMap<readonly string[], readonly
// string[]>`.
//
// Why this key kind is admitted while a record-keyed one is not: an array
// whose elements carry no cycle header is allocated by plain malloc
// (scr_arr_new_ref only routes through scr_cyc_alloc when elem_trace is
// non-NULL) and freed by a plain free in scr_arr_release, which never
// reaches scr_cyc_free. That is one death chokepoint the runtime owns, the
// same property ScrBytes has. A TRACED array is a cycle node the collector
// can reclaim without passing through any release, and is refused — see
// tests/diagnostics/weakmap-traced-array-key.ts for that side of the line.
//
// As with 7782, the in-language surface is all this can pin; the lifetime
// property is pinned in C by packages/runtime/test/test_weak.c.

const cache = new WeakMap<readonly string[], readonly string[]>();

const k1: readonly string[] = ["a", "b"];
const k2: readonly string[] = ["a", "b"]; // equal contents, DIFFERENT key

console.log("empty get:", cache.get(k1) === undefined);
console.log("empty has:", cache.has(k1));

cache.set(k1, ["x", "y", "z"]);

const hit = cache.get(k1);
console.log("hit len:", hit === undefined ? -1 : hit.length);
console.log("hit join:", hit === undefined ? "-" : hit.join("|"));
console.log("has k1:", cache.has(k1));

// Identity, not contents — the line that fails if arrays are ever hashed
// structurally.
console.log("equal-contents key is different:", cache.has(k2), cache.get(k2) === undefined);

cache.set(k2, ["q"]);
const a = cache.get(k1);
const b = cache.get(k2);
console.log("two keys:", a === undefined ? "-" : a.join("|"), b === undefined ? "-" : b.join("|"));

// Overwrite.
cache.set(k1, ["new"]);
const re = cache.get(k1);
console.log("overwrite:", re === undefined ? "-" : re.join("|"));

// An empty array key, and a never-inserted key on a populated table.
const empty: readonly string[] = [];
console.log("empty-array key absent:", cache.get(empty) === undefined, cache.has(empty));
cache.set(empty, ["e"]);
const ev = cache.get(empty);
console.log("empty-array key works:", ev === undefined ? "-" : ev.join("|"));

// Enough keys to force growth and rehashing.
const many: (readonly string[])[] = [];
for (let i = 0; i < 40; i++) {
  const k: readonly string[] = ["k" + i];
  many.push(k);
  cache.set(k, ["v" + i]);
}
let found = 0;
let acc = "";
for (let i = 0; i < many.length; i++) {
  const v = cache.get(many[i]!);
  if (v !== undefined) {
    found++;
    if (i < 3) acc += v.join("") + ",";
  }
}
console.log("after growth:", found, acc);

// The originals survive the growth the bulk inserts caused.
const a2 = cache.get(k1);
const b2 = cache.get(k2);
console.log("originals survive:", a2 === undefined ? "-" : a2.join("|"), b2 === undefined ? "-" : b2.join("|"));

// A Uint8Array-keyed table alongside, to show both admitted key kinds
// coexist in one program (two different stamps, one registry).
const bytesCache = new WeakMap<Uint8Array, readonly string[]>();
const bk = new Uint8Array([7, 7]);
bytesCache.set(bk, ["bytes-keyed"]);
const bv = bytesCache.get(bk);
console.log("both key kinds:", bv === undefined ? "-" : bv.join("|"), cache.has(k1));
