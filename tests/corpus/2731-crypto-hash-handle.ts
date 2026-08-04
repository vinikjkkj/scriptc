// The MATERIALIZED Hash handle — every shape the fused chain cannot see:
// the handle bound to a variable, updated more than once, updated in a
// loop, handed to a function as a parameter, returned from one, and
// digested at a distance from where it was made. The fused chain is still
// exercised beside it (1534-crypto-hash-chain.ts), and both forms must
// answer the same digests.
import { createHash } from "node:crypto";
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

// A handle in an array-free container position: passed twice, still one
// message (the handle is a reference, not a copy).
function bump(target: crypto.Hash): void {
  target.update("x");
}
const shared = createHash("sha256");
bump(shared);
bump(shared);
console.log(shared.digest("hex"));
