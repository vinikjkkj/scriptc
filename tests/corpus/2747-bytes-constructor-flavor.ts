// `x.constructor === Uint8Array` / `=== Buffer` on a bytes<u8> value.
//
// ONE ScrBytes representation serves Uint8Array AND Buffer, so this is
// the one question the representation erased -- `instanceof Uint8Array`
// JOINS the two spellings (a Buffer is instanceof Uint8Array, which is
// why THAT test folds from the static type), while `.constructor`
// SEPARATES them. No checker type can answer it: nearly every Buffer in
// real code arrives through a Uint8Array-typed slot, and folding from
// the slot says TRUE where Node says false. So the flavor rides the
// VALUE, stamped by whichever Node spelling produced it.
//
// Every line here is checked against Node, and the interesting half is
// the pairs that share ONE runtime constructor: Buffer.alloc vs new
// Uint8Array(n), Buffer.from([..]) vs new Uint8Array([..]),
// Buffer.from(str) vs TextEncoder.encode, Buffer.from(x.buffer, ..) vs
// new Uint8Array(x.buffer, ..). If the stamp were dropped at any of
// them the two halves of the pair would answer the same.
//
// NOT covered, deliberately: a DataView cast to Uint8Array. DataView is
// neither of the two constructors this flag distinguishes, so the read
// REFUSES at runtime rather than picking one -- see the unclassified
// case at the bottom, which is the designed loud failure.
import { createHash, createHmac, randomBytes } from "node:crypto";

function ctorIsU8(x: Uint8Array): boolean {
  return x.constructor === Uint8Array;
}
// The corpus compiles against the FALLBACK .d.ts, where .constructor is
// typed Function and Buffer is BufferConstructor -- tsc rejects the
// `=== Buffer` spelling outright there. Buffer.isBuffer asks the same
// runtime question and does typecheck, so it stands in (and it is the
// merged wrong answer this change also fixes). The `=== Buffer` spelling
// itself is exercised in G:/zapo-work/app/bb-ctor.ts, which has
// @types/node.
function ctorIsBuffer(x: Uint8Array): boolean {
  return Buffer.isBuffer(x);
}
function show(label: string, x: Uint8Array): void {
  console.log(label, ctorIsU8(x), ctorIsBuffer(x), x.constructor !== Uint8Array);
}

// ── the pairs that share one runtime constructor ──────────────────────
show("alloc      ", Buffer.alloc(4));
show("new U8(n)  ", new Uint8Array(4));

show("from[]     ", Buffer.from([1, 2, 3]));
show("new U8([])  ", new Uint8Array([1, 2, 3]));

show("from(str)  ", Buffer.from("abc", "utf8"));
show("encode(str)", new TextEncoder().encode("abc"));

const owner = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
show("from(.buf) ", Buffer.from(owner.buffer, 2, 4));
show("new U8(.buf)", new Uint8Array(owner.buffer, 2, 4));

const buf = Buffer.from([9, 8, 7, 6]);
show("new U8(buf)", new Uint8Array(buf)); // the COPY ctor takes ITS flavor
show("from(u8)   ", Buffer.from(owner)); // ... and so does this one

// ── producers with only one Node spelling ─────────────────────────────
show("digest     ", createHash("sha256").update("abc").digest());
show("hmac       ", createHmac("sha256", "k").update("abc").digest());
show("randomBytes", randomBytes(8));
show("concat     ", Buffer.concat([buf, buf]));
show("empty      ", Buffer.concat([]));

// ── propagation: species-built methods keep the receiver's flavor ─────
show("buf.slice  ", buf.slice(1, 3));
show("buf.subarr ", buf.subarray(1, 3));
show("buf.fill   ", Buffer.alloc(4).fill(7));
show("u8.slice   ", owner.slice(1, 3));
show("u8.subarr  ", owner.subarray(1, 3));
// ... while toReversed/with build through the INTRINSIC constructor and
// answer a plain Uint8Array even from a Buffer.
show("buf.toRev  ", buf.toReversed());
show("buf.with   ", buf.with(0, 1));
show("u8.toRev   ", owner.toReversed());

// A view of a view, and a slice of a subarray: depth does not lose it.
show("buf.sub.sub", buf.subarray(1, 4).subarray(1));
show("buf.sub.sli", buf.subarray(1, 4).slice(0, 1));

// ── the whole point: toBytesView, verbatim ────────────────────────────
// The funnel every crypto result and every inbound frame passes through.
// Its two branches produce the same BYTES over the same memory; only
// IDENTITY differs, which is exactly why a static fold looked harmless
// and was not.
function toBytesView(value: Uint8Array): Uint8Array {
  return value.constructor === Uint8Array
    ? value
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}
const digest = createHash("sha256").update("abc").digest();
const viewOfDigest = toBytesView(digest);
const viewOfPlain = toBytesView(owner);
console.log("wrapped-buffer", viewOfDigest === (digest as unknown as Uint8Array));
console.log("passed-plain  ", viewOfPlain === owner);
console.log("same-bytes    ", viewOfDigest[0], viewOfDigest[31], viewOfDigest.length);
console.log("re-view-flavor", ctorIsU8(viewOfDigest), ctorIsBuffer(viewOfDigest));
// The re-wrap ALIASES, exactly as Node's does.
digest[0] = 42;
console.log("aliases       ", viewOfDigest[0]);

// ── the negated spelling, and the reversed operand order ──────────────
console.log("!==-buffer", digest.constructor !== Uint8Array);
console.log("!==-plain ", owner.constructor !== Uint8Array);
console.log("flipped   ", Uint8Array === owner.constructor, Uint8Array === digest.constructor);

// ── a loop over both flavors: the branch is real, not folded ──────────
const mixed: Uint8Array[] = [owner, digest, buf, new Uint8Array(2), Buffer.alloc(2)];
let plainCount = 0;
let bufCount = 0;
for (const m of mixed) {
  if (m.constructor === Uint8Array) plainCount++;
  else bufCount++;
}
console.log("counts", plainCount, bufCount);

// ── stress: the stamp must not leak or double-free ────────────────────
let acc = 0;
for (let i = 0; i < 200000; i++) {
  const b = Buffer.alloc(4);
  const u = new Uint8Array(4);
  if (b.constructor === Uint8Array) acc += 1;
  if (u.constructor === Uint8Array) acc += 2;
  const s: Uint8Array = b.subarray(0, 2);
  if (Buffer.isBuffer(s)) acc += 4;
}
console.log("stress", acc);
