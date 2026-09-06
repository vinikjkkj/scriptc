// WeakMap over Uint8Array keys — the shape zapo-js 1.8.2's crypto caches
// use (crypto/curves/X25519.ts:116-117, crypto/core/xeddsa.ts:73).
//
// What a DIFFERENTIAL test can pin here, and what it cannot.
//
// It CAN pin the whole in-language surface: that a key is matched by
// reference identity rather than by contents, that a byte-identical
// Uint8Array is a different key, that a miss answers `undefined`, that
// overwrite replaces, and that two keys stay apart. All of that must be
// byte-exact against Node, and it is what this file checks.
//
// It CANNOT pin the property the feature exists for — that an entry
// disappears when its key dies, and that a recycled address does not
// inherit a dead key's value. Those are not observable from inside JS by
// design (no finalizer, no WeakRef surface, no iteration), which is
// precisely why a strong Map passed for a WeakMap in this compiler for so
// long. They are pinned in C instead, by packages/runtime/test/test_weak.c,
// and that file is the one to read for the lifetime argument.

interface Deriv {
  readonly n: number;
  readonly tag: string;
}

const cache = new WeakMap<Uint8Array, Deriv>();

const k1 = new Uint8Array([1, 2, 3]);
const k2 = new Uint8Array([1, 2, 3]); // byte-identical, and a DIFFERENT key

console.log("empty get:", cache.get(k1) === undefined);
console.log("empty has:", cache.has(k1));

cache.set(k1, { n: 7, tag: "seven" });

const hit = cache.get(k1);
console.log("hit:", hit === undefined ? "MISS" : hit.n, hit === undefined ? "-" : hit.tag);
console.log("has k1:", cache.has(k1));

// Identity, not contents. This is the line that would fail if WeakMap were
// ever quietly hashed by value.
console.log("has k2 (identity, must be false):", cache.has(k2));
console.log("get k2:", cache.get(k2) === undefined);

cache.set(k1, { n: 9, tag: "nine" });
const re = cache.get(k1);
console.log("overwrite:", re === undefined ? "MISS" : re.n);

cache.set(k2, { n: 4, tag: "four" });
const a = cache.get(k1);
const b = cache.get(k2);
console.log("two keys:", a === undefined ? "-" : a.n, b === undefined ? "-" : b.n);

// A key that was never inserted, on a populated table: the probe has to walk
// past real entries and still miss.
const k3 = new Uint8Array([9, 9, 9]);
console.log("absent key on a populated table:", cache.get(k3) === undefined, cache.has(k3));

// Enough keys to force at least one growth and rehash.
const many: Uint8Array[] = [];
for (let i = 0; i < 40; i++) {
  const k = new Uint8Array([i, i + 1, i + 2]);
  many.push(k);
  cache.set(k, { n: i * 2, tag: "bulk" });
}
let sum = 0;
let found = 0;
for (let i = 0; i < many.length; i++) {
  const v = cache.get(many[i]!);
  if (v !== undefined) {
    sum += v.n;
    found++;
  }
}
console.log("after growth:", found, sum);

// The originals must survive the growth that the bulk inserts caused.
const a2 = cache.get(k1);
const b2 = cache.get(k2);
console.log("originals survive growth:", a2 === undefined ? "-" : a2.n, b2 === undefined ? "-" : b2.n);
