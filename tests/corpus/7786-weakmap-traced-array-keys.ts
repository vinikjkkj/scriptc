// WeakMap keyed by a TRACED array — the key kind phase 3's collector hook
// admitted, and the shape of zapo-js 1.8.2's `prevSessionsSuffixCache`
// (signal/session/encoding.ts:229): a per-array-instance memo of an encoded
// byte suffix, keyed on an array the producer replaces wholesale.
//
// 7785 is the UNTRACED flavour and it turns on a different mechanism. An
// untraced array is a plain malloc whose one death chokepoint is
// scr_arr_release. A TRACED array — one whose elements carry a cycle header,
// which here means an element type that can transitively reach itself — is
// allocated through scr_cyc_alloc and can be reclaimed by the collector's
// collectWhite without scr_arr_release ever running. That second route is
// why it was refused before, and hooking scr_cyc_free is what admits it:
// BOTH routes converge there (an ordinary release-to-zero runs
// scr_arr_gc_free, which ends in scr_cyc_free; the collector calls that same
// teardown directly).
//
// WHAT THIS FILE CAN AND CANNOT PIN. Weakness is not observable from inside
// the language — that is the point of a WeakMap, and it is why this program
// is a differential at all: every line here must match node exactly, and
// none of them can see a collection. The lifetime properties are pinned in
// C, by packages/runtime/test/test_weak.c cases 10-12, where the ring is
// built by hand and scr_collect_cycles is called explicitly. What this file
// pins is the in-language surface: identity rather than contents, growth,
// overwrite, and the two stamps coexisting in one program.

interface Tree {
  readonly id: number;
  readonly kids: readonly Tree[];
}

const suffixCache = new WeakMap<readonly Tree[], Uint8Array>();

function total(rows: readonly Tree[]): number {
  let n = 0;
  for (const t of rows) n += t.id + total(t.kids);
  return n;
}

function encode(rows: readonly Tree[]): Uint8Array {
  const hit = suffixCache.get(rows);
  if (hit !== undefined) return hit;
  const n = total(rows);
  const fresh = new Uint8Array([n & 0xff, (n >> 8) & 0xff, rows.length]);
  suffixCache.set(rows, fresh);
  return fresh;
}

const a: readonly Tree[] = [
  { id: 1, kids: [{ id: 2, kids: [] }, { id: 3, kids: [{ id: 4, kids: [] }] }] },
  { id: 10, kids: [] },
];
// Equal CONTENTS, a different key — the line that fails if arrays are ever
// hashed structurally rather than by address.
const aTwin: readonly Tree[] = [
  { id: 1, kids: [{ id: 2, kids: [] }, { id: 3, kids: [{ id: 4, kids: [] }] }] },
  { id: 10, kids: [] },
];
const b: readonly Tree[] = [{ id: 300, kids: [] }];

console.log("empty get:", suffixCache.get(a) === undefined);
console.log("empty has:", suffixCache.has(a));

const ea = encode(a);
console.log("a:", ea[0], ea[1], ea[2], suffixCache.has(a));
console.log("a twice is the same object:", encode(a) === ea);
console.log("equal-contents key is different:", suffixCache.has(aTwin), suffixCache.get(aTwin) === undefined);

const eb = encode(b);
console.log("b:", eb[0], eb[1], eb[2], suffixCache.has(b));
console.log("a survives b:", encode(a) === ea);

// Overwrite: the second set replaces the value and releases the first.
suffixCache.set(a, new Uint8Array([9, 9, 9]));
const over = suffixCache.get(a);
console.log("overwrite:", over === undefined ? -1 : over[0], over === undefined ? -1 : over[2]);

// An EMPTY array key, and a never-inserted key on a populated table.
const empty: readonly Tree[] = [];
console.log("empty-array key absent:", suffixCache.get(empty) === undefined, suffixCache.has(empty));
suffixCache.set(empty, new Uint8Array([0, 0, 0]));
const ev = suffixCache.get(empty);
console.log("empty-array key works:", ev === undefined ? -1 : ev.length);

// Enough keys to force growth and rehashing, with a nested kid on each so
// every key really is a traced array and not an accidentally empty one.
const many: (readonly Tree[])[] = [];
for (let i = 0; i < 40; i++) {
  const k: readonly Tree[] = [{ id: i, kids: [{ id: i + 1, kids: [] }] }];
  many.push(k);
  encode(k);
}
let found = 0;
let acc = "";
for (let i = 0; i < many.length; i++) {
  const v = suffixCache.get(many[i]!);
  if (v !== undefined) {
    found++;
    if (i < 3) acc += String(v[0]) + ",";
  }
}
console.log("after growth:", found, acc);

// The originals survive the growth the bulk inserts caused.
const a3 = suffixCache.get(a);
const b3 = suffixCache.get(b);
console.log("originals survive:", a3 === undefined ? -1 : a3[0], b3 === undefined ? -1 : b3[0]);

// A key that goes out of scope while the table lives. Nothing in-language
// can see the eviction; what this pins is that the program does not lose
// the entries that are still live, and (under SCRIPTC_RC_AUDIT) that the
// value the dropped key held was released exactly once.
function transient(): number {
  const t: readonly Tree[] = [{ id: 77, kids: [{ id: 78, kids: [] }] }];
  const e = encode(t);
  return e[0]!;
}
console.log("transient:", transient(), transient());
console.log("live keys still hit:", encode(a)[0], encode(b)[0]);

// ALL THREE stamps in one program: bytes (scr_bytes_weak_mark), an untraced
// array (scr_arr_weak_mark, ScrArr's own byte) and a traced array
// (scr_cyc_weak_mark, the cycle header's SCR_CYC_WEAKKEY bit). Picking the
// wrong one is a stray store into a struct with no such field, so having
// all three live at once is the cheap version of that check.
const bytesKeyed = new WeakMap<Uint8Array, Uint8Array>();
const bk = new Uint8Array([7, 7]);
bytesKeyed.set(bk, new Uint8Array([1, 2, 3]));
const untracedKeyed = new WeakMap<readonly string[], Uint8Array>();
const uk: readonly string[] = ["p", "q"];
untracedKeyed.set(uk, new Uint8Array([4, 5]));
const bv = bytesKeyed.get(bk);
const uv = untracedKeyed.get(uk);
console.log(
  "three stamps:",
  bv === undefined ? -1 : bv[2],
  uv === undefined ? -1 : uv[1],
  encode(a)[0],
);
