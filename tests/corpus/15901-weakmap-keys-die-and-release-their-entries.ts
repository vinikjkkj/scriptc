// A WeakMap keyed on class instances, with the keys created and dropped in a
// loop. Two properties are pinned here:
//
//  1. ADDRESS REUSE. A dead key's storage is handed straight back out by the
//     allocator, so the next instance can land at the same address. An entry
//     that outlived its key would answer `has` true for a stranger. Every
//     `has` below must be false on a fresh key, in a loop long enough to
//     recycle the blocks many times.
//
//  2. BOUNDED MEMORY. Each entry's VALUE is a 1 KiB buffer. If an entry
//     survived its key the table would hold every buffer; the RC audit
//     (SCRIPTC_RC_AUDIT=1 --sanitize) fails the run if a single one is still
//     live at exit, and the loop would balloon long before that.
//
// The answers are Node's: a fresh key never has an entry, and the value a
// live key holds is the one it was given.

class Id {
  readonly n: number;
  constructor(n: number) {
    this.n = n;
  }
}

const ITER = 60000;
const cache = new WeakMap();

let strangers = 0;
let hits = 0;
let mismatches = 0;

for (let i = 0; i < ITER; i++) {
  const k = new Id(i);
  if (cache.has(k)) strangers++;
  const v = new Uint8Array(1024);
  v[0] = i & 0xff;
  cache.set(k, v);
  const got = cache.get(k);
  if (got !== undefined && got.length === 1024 && got[0] === (i & 0xff)) hits++;
  else mismatches++;
  // k goes out of scope here: its entry dies with it.
}

console.log("iterations:", ITER);
console.log("strangers found:", strangers);
console.log("hits:", hits, "mismatches:", mismatches);

// A key that is still live keeps its entry across a churn of dead ones.
const keeper = new Id(-1);
cache.set(keeper, new Uint8Array([7, 7, 7]));
for (let i = 0; i < 5000; i++) {
  const t = new Id(i);
  cache.set(t, new Uint8Array(16));
}
const kept = cache.get(keeper);
console.log("keeper:", kept === undefined ? -1 : kept.length, kept === undefined ? -1 : kept[0]);

// After the churn, a brand-new key still sees nothing.
let fresh = 0;
for (let i = 0; i < 2000; i++) {
  if (cache.has(new Id(1000000 + i))) fresh++;
}
console.log("fresh strangers:", fresh);
