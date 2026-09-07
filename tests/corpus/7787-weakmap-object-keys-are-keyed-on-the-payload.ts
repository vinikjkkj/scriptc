// `WeakMap<object, V>` — the fourth admitted key type, and the only one
// whose key ADDRESS and key STAMP are both decided at run time.
//
// TypeScript's bare `object` is the NonPrimitive intrinsic and mapType
// lowers it to the DYN, so this table's key column holds a ScrDyn. That
// makes it different in kind from 7782 (bytes), 7785 (untraced arrays) and
// 7786 (traced arrays), each of which knows its key's shape statically.
//
// THE RULE IT FOLLOWS IS scr_dyn_strict_eq's, arm for arm: the box is a
// boundary artifact and the JS value is the PAYLOAD. A WeakMap and `===`
// have to agree about what "the same object" is, or the table answers a
// question the language does not ask. So a Uint8Array key is keyed on its
// ScrBytes (which the crossing SHARES), a static array is keyed on the
// ScrArr the copy was made FROM (scr_dyn_origin_mark records it), and a
// dyn-land array or object — which has no second representation at all —
// is keyed on itself, which is what strict_eq's default arm says too.
//
// WHAT THIS FILE CAN PIN. Weakness is unobservable from inside the
// language, which is the point of a WeakMap and the reason this is a
// differential: every line must match node exactly and none of them can
// see a collection. What it CAN pin, and what nothing else does, is that
// the table hits at all — because the failure mode here is not a crash, it
// is a cache keyed on a temporary that misses every lookup and stays
// silent. `set` and `get` in adjacent statements pass two different boxes
// of one array; if this table were keyed on the box, every "hit" line
// below would print a miss and the program would still exit 0.
//
// The lifetime half is pinned in C by packages/runtime/test/test_weak.c
// cases 13-17 — including the freelist PARK, which is the give-back route
// scr_cyc_free never sees and which needs its own non-audit binary because
// SCR_RC_AUDIT compiles the freelist out.

interface Row {
  readonly a: number;
  readonly b: string;
}

const cache = new WeakMap<object, Uint8Array>();

const rows: readonly Row[] = [{ a: 1, b: "x" }];
const twin: readonly Row[] = [{ a: 1, b: "x" }]; // equal contents, DIFFERENT key

console.log("empty get:", cache.get(rows) === undefined);
console.log("empty has:", cache.has(rows));

cache.set(rows, new Uint8Array([1, 2, 3]));

// THE line. `rows` crosses the dyn boundary once per statement, so this
// read holds a different box than the write did.
const hit = cache.get(rows);
console.log("hit:", hit === undefined ? -1 : hit.length, cache.has(rows));

console.log("identity not contents:", cache.has(twin), cache.get(twin) === undefined);

cache.set(rows, new Uint8Array([9]));
const re = cache.get(rows);
console.log("overwrite:", re === undefined ? -1 : re[0]);

// A Uint8Array through the SAME `object`-keyed table: a second admitted
// payload kind, a second stamp, one registry.
const bk = new Uint8Array([7, 7]);
console.log("bytes empty:", cache.get(bk) === undefined);
cache.set(bk, new Uint8Array([42]));
const bv = cache.get(bk);
console.log("bytes key:", bv === undefined ? -1 : bv[0], cache.has(bk));

// A value built in dyn-land: no static representation behind it, so the
// box IS the JS value and keys on itself.
const parsed = JSON.parse('{"a":1}') as object;
console.log("parsed empty:", cache.get(parsed) === undefined);
cache.set(parsed, new Uint8Array([5]));
const pv = cache.get(parsed);
console.log("parsed hit:", pv === undefined ? -1 : pv[0], cache.has(parsed));
const parsed2 = JSON.parse('{"a":1}') as object;
console.log("distinct parse:", cache.has(parsed2), cache.get(parsed2) === undefined);

const dynArr = JSON.parse("[1,2,3]") as object;
cache.set(dynArr, new Uint8Array([6]));
const dv = cache.get(dynArr);
console.log("dyn array key:", dv === undefined ? -1 : dv[0]);

// THE REFUSALS. Node throws `TypeError: Invalid value used as weak map key`
// from set() for a primitive and answers undefined/false from get()/has(),
// and scriptc reproduces both halves — the message verbatim, because Node
// refuses these for the same reason this runtime does (there is no address
// to key on). A key the table can never hold cannot be present, so only the
// write side has a lie to tell.
const num = JSON.parse("42") as object;
try {
  cache.set(num, new Uint8Array([1]));
  console.log("number key: NO THROW");
} catch (e) {
  // The CLASS as well as the text: matching the message while throwing a
  // plain Error would break `catch (e) { if (e instanceof TypeError) ... }`,
  // which is the shape a caller actually writes.
  console.log("number key:", (e as Error).message, e instanceof TypeError, (e as Error).name);
}
console.log("number read side:", cache.get(num) === undefined, cache.has(num));

const str = JSON.parse('"s"') as object;
try {
  cache.set(str, new Uint8Array([1]));
  console.log("string key: NO THROW");
} catch (e) {
  console.log("string key:", (e as Error).message);
}

const bool = JSON.parse("true") as object;
try {
  cache.set(bool, new Uint8Array([1]));
  console.log("bool key: NO THROW");
} catch (e) {
  console.log("bool key:", (e as Error).message);
}

const nul = JSON.parse("null") as object;
try {
  cache.set(nul, new Uint8Array([1]));
  console.log("null key: NO THROW");
} catch (e) {
  console.log("null key:", (e as Error).message);
}

// The table survived every refusal with its entries intact — a refused set
// that had written the slot before throwing would be the address-reuse
// hazard with extra steps.
console.log("survivors:", cache.has(rows), cache.has(bk), cache.has(parsed));

// Enough keys to force growth and rehashing, mixing all three payload
// kinds so the rehash walks addresses of three different provenances.
const many: (readonly Row[])[] = [];
for (let i = 0; i < 30; i++) {
  const k: readonly Row[] = [{ a: i, b: "k" }];
  many.push(k);
  cache.set(k, new Uint8Array([i]));
}
const bytesKeys: Uint8Array[] = [];
for (let i = 0; i < 10; i++) {
  const k = new Uint8Array([i, i]);
  bytesKeys.push(k);
  cache.set(k, new Uint8Array([100 + i]));
}
let found = 0;
for (let i = 0; i < many.length; i++) {
  if (cache.get(many[i]!) !== undefined) found++;
}
for (let i = 0; i < bytesKeys.length; i++) {
  if (cache.get(bytesKeys[i]!) !== undefined) found++;
}
console.log("after growth:", found);

// The originals survive the growth the bulk inserts caused.
const a2 = cache.get(rows);
const b2 = cache.get(bk);
console.log("originals survive:", a2 === undefined ? -1 : a2[0], b2 === undefined ? -1 : b2[0]);

// The zapo-js 1.8.2 shape it was written for: a suffix memoised per array
// instance, recomputed only when the producer replaces the array wholesale
// (signal/session/encoding.ts:229).
function suffixOf(prev: readonly Row[]): Uint8Array {
  const memo = cache.get(prev);
  if (memo !== undefined) return memo;
  const fresh = new Uint8Array([prev.length, prev.length * 2]);
  cache.set(prev, fresh);
  return fresh;
}
const first = suffixOf(rows);
const second = suffixOf(rows);
console.log("memo:", first[0], second[0], first === second);

// THE INDIRECT CROSSING. Here the value becomes a dyn at the CALL site and
// the key position inside sees a plain `object`, so the static argument
// check has nothing left to look at and the runtime resolution is on its
// own. It is also the route by which a refused kind reaches that resolution
// at all — `weakKeyArgIsIdentity` catches the direct spelling and cannot
// catch this one, which is why the runtime refusals are the real fence and
// not belt-and-braces.
function put(k: object, v: Uint8Array): void {
  cache.set(k, v);
}
function got(k: object): boolean {
  return cache.has(k);
}
const late: readonly Row[] = [{ a: 9, b: "z" }];
console.log("indirect before:", got(late));
put(late, new Uint8Array([77]));
const lv = cache.get(late);
console.log("indirect after:", got(late), lv === undefined ? -1 : lv[0]);
