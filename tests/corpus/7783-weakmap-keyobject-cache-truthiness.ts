// The WeakMap-backed KeyObject cache, and the `if (cached)` on the line
// after the lookup. This is one IDIOM, not two features, and taking it as
// two is what made it look like two separate refusals.
//
// zapo-js 1.8.2 writes it four times (crypto/curves/X25519.ts
// x25519PrivateKeyObject / x25519PublicKeyObject, and the xeddsa pair):
//
//     const privateKeyObjectCache = new WeakMap();
//     const cached = privateKeyObjectCache.get(privKey);
//     if (cached) return cached;                    // <- keyobj | undefined
//     const keyObject = createPrivateKey(...);
//     privateKeyObjectCache.set(privKey, keyObject);
//
// `get` on a `WeakMap<Uint8Array, KeyObject>` answers `KeyObject |
// undefined`, so the truthiness test on the very next line is not an
// independent construct — it is the half of the idiom that READS the
// lookup. A backend that lowers the WeakMap but refuses the test moves the
// wall down one line and closes nothing.
//
// What this file pins, all of it byte-exact against Node:
//   * a miss answers undefined, so `if (cached)` takes the false branch;
//   * a hit answers the SAME handle, and the truthy branch returns it;
//   * identity is by REFERENCE — a byte-identical Uint8Array is a
//     different key and therefore a miss;
//   * the cached handle still WORKS (the HMAC it produces is the one the
//     raw material produces), so the value survived the round trip
//     through the weak table with its refcount intact;
//   * and the same truthiness test over the other four crypto handles —
//     Hash, Hmac, Cipher, Decipher — because they share the widened arm
//     set and one proven kind out of five is not a proof.
import { createSecretKey, createHmac, createHash, createCipheriv, createDecipheriv } from "node:crypto";
import type { KeyObject } from "node:crypto";

const keyCache = new WeakMap<Uint8Array, KeyObject>();

function keyFor(material: Uint8Array): KeyObject {
  const cached = keyCache.get(material);
  if (cached) {
    return cached;
  }
  const made = createSecretKey(material);
  keyCache.set(material, made);
  return made;
}

const m1 = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
const m2 = Buffer.from("0123456789abcdef0123456789abcdef", "utf8"); // same BYTES, different object

// First call is a miss: the cache is empty, so `if (cached)` is false.
console.log("has before:", keyCache.has(m1));
const k1 = keyFor(m1);
console.log("has after:", keyCache.has(m1));

// Second call is a HIT and must return the very same handle. Checked
// through BEHAVIOUR rather than by `===`: comparing two KeyObject handles
// is SC1043 ("comparing non-number, non-string values"), a standing
// language limit unrelated to the weak table, so the MACs are the
// evidence. All three lines below must print the same digest.
const k1again = keyFor(m1);
console.log(createHmac("sha256", k1).update("abc").digest("hex"));
console.log(createHmac("sha256", k1again).update("abc").digest("hex"));
console.log(createHmac("sha256", m1).update("abc").digest("hex"));

// Byte-identical material is a DIFFERENT key: reference identity, not
// contents. So m2 is a miss even though m1 is present.
console.log("m2 is a miss:", !keyCache.has(m2));
const k2 = keyFor(m2);
console.log("m2 cached after:", keyCache.has(m2));
// Distinct HANDLES, equal material: the MACs must agree even though the
// two cache entries are separate. (String comparison is fine; it is only
// the handles themselves that cannot be compared.)
console.log("equal MACs:", createHmac("sha256", k1).update("x").digest("hex") === createHmac("sha256", k2).update("x").digest("hex"));

// The miss branch, observed directly: `get` answers undefined and the
// truthiness test takes the false arm.
const absent = keyCache.get(Buffer.from("never-inserted", "utf8"));
console.log("absent is undefined:", absent === undefined);
if (absent) {
  console.log("UNREACHABLE: a miss must not be truthy");
} else {
  console.log("miss took the false arm");
}

// Overwrite replaces the value for a live key.
const replaced = createSecretKey(Buffer.from("replacement-material", "utf8"));
keyCache.set(m1, replaced);
const after = keyCache.get(m1);
// The overwrite is observed through the MAC the stored handle produces:
// it must now be the REPLACEMENT's, not the original material's.
if (after) {
  const got = createHmac("sha256", after).update("abc").digest("hex");
  console.log("overwritten:", got === createHmac("sha256", replaced).update("abc").digest("hex"));
  console.log("no longer the original:", got !== createHmac("sha256", m1).update("abc").digest("hex"));
} else {
  console.log("UNREACHABLE: overwritten key must still be present");
}

// ── the other four handles that share the widened arm set ──────────────
// Each is `Handle | undefined`, and each `if (h)` is the same constant-true
// answer for the object arm. The undefined arm is real, not folded away:
// both branches are exercised.
const wantHandles = m1.length > 0; // true, but not a literal the checker folds

const maybeHash: ReturnType<typeof createHash> | undefined = wantHandles ? createHash("sha256") : undefined;
if (maybeHash) {
  console.log("hash:", maybeHash.update("abc").digest("hex"));
} else {
  console.log("UNREACHABLE hash");
}

const maybeHmac: ReturnType<typeof createHmac> | undefined = wantHandles ? createHmac("sha256", m1) : undefined;
if (maybeHmac) {
  console.log("hmac:", maybeHmac.update("abc").digest("hex"));
} else {
  console.log("UNREACHABLE hmac");
}

const iv = Buffer.alloc(16, 7);
const aesKey = Buffer.alloc(32, 3);
const maybeCipher: ReturnType<typeof createCipheriv> | undefined = wantHandles ? createCipheriv("aes-256-cbc", aesKey, iv) : undefined;
let ct = "";
if (maybeCipher) {
  // The Buffer forms, not the encoded-string overloads: this surface
  // declares update(Buffer)/final() only, and the encoding overloads are
  // a different declaration that is not part of it.
  const head = maybeCipher.update(Buffer.from("a message", "utf8"));
  const tail = maybeCipher.final();
  ct = Buffer.concat([head, tail]).toString("hex");
  console.log("cipher:", ct);
} else {
  console.log("UNREACHABLE cipher");
}

const maybeDecipher: ReturnType<typeof createDecipheriv> | undefined = wantHandles ? createDecipheriv("aes-256-cbc", aesKey, iv) : undefined;
if (maybeDecipher) {
  const head = maybeDecipher.update(Buffer.from(ct, "hex"));
  const tail = maybeDecipher.final();
  console.log("decipher:", Buffer.concat([head, tail]).toString("utf8"));
} else {
  console.log("UNREACHABLE decipher");
}

// And the FALSE arm of the same union shape, so the test is not proving
// "always true" by only ever seeing a present value.
const noHandle: ReturnType<typeof createHash> | undefined = m1.length > 1000 ? createHash("sha1") : undefined;
console.log("absent handle is falsy:", noHandle ? "UNREACHABLE" : "took the false arm");
