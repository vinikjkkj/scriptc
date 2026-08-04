// The MATERIALIZED Hash handle — every shape the fused chain cannot see:
// the handle bound to a variable, updated more than once, updated in a
// loop, handed to a function as a parameter, returned from one, and
// digested at a distance from where it was made. The fused chain is still
// exercised beside it (1534-crypto-hash-chain.ts), and both forms must
// answer the same digests.
import { createHash, createHmac } from "node:crypto";
import * as crypto from "node:crypto";

// Bound to a variable, then updated and digested as ordinary members.
const h = createHash("sha256");
h.update("abc");
console.log(h.digest("hex"));

// Two updates: the message is the concatenation.
const two = createHash("sha256");
two.update("abc");
two.update("def");
console.log(two.digest("hex"));
console.log(createHash("sha256").update("abcdef").digest("hex"));

// Updated in a loop over chunks — zapo's `feed` shape.
function feed(target: crypto.Hash, chunks: readonly Uint8Array[]): crypto.Hash {
  for (let i = 0; i < chunks.length; i += 1) {
    target.update(chunks[i]!);
  }
  return target;
}
const chunks = [
  Buffer.from("hello ", "utf8"),
  Buffer.from("world", "utf8"),
  Buffer.from([0, 255, 128]),
];
console.log(Buffer.from(feed(createHash("sha512"), chunks).digest()).toString("hex"));
console.log(feed(createHash("sha256"), chunks).digest("hex"));
console.log(feed(createHash("sha1"), chunks).digest("base64"));

// The handle made in one function and digested in another. (The
// algorithm is a literal at the createHash site: it is baked into the
// handle, so a name the compiler cannot read fences there.)
function make256(): crypto.Hash {
  return createHash("sha256").update("seed");
}
function make512(): crypto.Hash {
  return createHash("sha512").update("seed");
}
console.log(make256().update("-tail").digest("hex"));
console.log(make512().digest("hex"));

// update() answers the same handle, so a chain off a bound one works too.
const chained = createHash("sha512");
console.log(chained.update("a").update("b").update("c").digest("hex"));

// An empty message: no update at all.
console.log(createHash("sha256").digest("hex"));
const never = createHash("sha512");
console.log(never.digest("hex"));

// A handle held across a growing message — 300 one-byte updates cross the
// accumulator's growth steps and both block sizes.
const many = createHash("sha512");
for (let i = 0; i < 300; i += 1) many.update("a");
console.log(many.digest("hex"));
console.log(createHash("sha512").update("a".repeat(300)).digest("hex"));

// Mixed string and Buffer updates into one handle.
const mixed = createHash("sha256");
mixed.update("head-");
mixed.update(Buffer.from([1, 2, 3]));
mixed.update("-tail");
console.log(mixed.digest("hex"));

// The namespace spelling of the constructor.
const ns = crypto.createHash("sha256");
ns.update("namespace");
console.log(ns.digest("base64"));

// Through a GENERIC function, the zapo `feed` shape: the parameter is
// declared by a type parameter, so inside the body the receiver reads as
// the CONSTRAINT rather than as the type the instance was made with.
function feedGeneric<T extends crypto.Hash>(target: T, chunks: readonly string[]): T {
  for (let i = 0; i < chunks.length; i += 1) {
    target.update(chunks[i]!);
  }
  return target;
}
console.log(feedGeneric(createHash("sha256"), ["a", "b", "c"]).digest("hex"));
console.log(feedGeneric(createHash("sha512"), ["a", "b", "c"]).digest("hex"));
console.log(createHash("sha512").update("abc").digest("hex"));

// A handle in an array-free container position: passed twice, still one
// message (the handle is a reference, not a copy).
function bump(target: crypto.Hash): void {
  target.update("x");
}
const shared = createHash("sha256");
bump(shared);
bump(shared);
console.log(shared.digest("hex"));

// ── Hmac: the same handle, keyed (RFC 2104) ─────────────────────────
const mac = createHmac("sha256", "key");
mac.update("The quick brown fox jumps over the lazy dog");
console.log(mac.digest("hex"));
console.log(createHmac("sha256", "key").update("abc").digest("base64"));
console.log(createHmac("sha512", "key").update("abc").digest("hex"));
console.log(createHmac("sha1", "key").update("abc").digest("hex"));

// A Buffer key, and the raw-Buffer digest.
const bkey = Buffer.from([1, 2, 3, 4, 5]);
console.log(Buffer.from(createHmac("sha256", bkey).update("abc").digest()).toString("hex"));
console.log(crypto.createHmac("sha512", bkey).update("abc").digest("hex"));

// An empty key and an empty message — both legal in Node.
console.log(createHmac("sha256", "").update("").digest("hex"));

// A key LONGER than the block (RFC 2104 hashes it first): 64 is the
// sha256 block, 128 the sha512 one, so 200 is over both and 100 is over
// only the first.
console.log(createHmac("sha256", "k".repeat(100)).update("abc").digest("hex"));
console.log(createHmac("sha512", "k".repeat(100)).update("abc").digest("hex"));
console.log(createHmac("sha512", "k".repeat(200)).update("abc").digest("hex"));
console.log(createHmac("sha256", "k".repeat(64)).update("abc").digest("hex"));
console.log(createHmac("sha512", "k".repeat(128)).update("abc").digest("hex"));

// Chunked and passed through a generic, zapo's hmacSha256Sign shape.
function feedMac<T extends crypto.Hmac>(target: T, chunks: readonly Uint8Array[]): T {
  for (let i = 0; i < chunks.length; i += 1) {
    target.update(chunks[i]!);
  }
  return target;
}
console.log(Buffer.from(feedMac(createHmac("sha256", bkey), chunks).digest()).toString("hex"));
console.log(Buffer.from(feedMac(createHmac("sha512", bkey), chunks).digest()).toString("hex"));

// Mixed string/Buffer updates and a multi-block message.
const bigMac = createHmac("sha512", bkey);
bigMac.update("head-");
bigMac.update(Buffer.from("x".repeat(300), "utf8"));
console.log(bigMac.digest("hex"));
