// createCipheriv / createDecipheriv over AES-256 in the three modes the
// runtime implements. The point of the differential is not the ciphertext
// alone — the NIST vectors already pin that — but Node's CHUNKING: which
// bytes come back from update() and which from final(), because a caller
// that concatenates cannot tell and a caller that measures can. Every case
// below prints both lengths as well as the bytes.
//
// The shapes are zapo's own (crypto/core/primitives.ts): a local handle,
// a CONDITIONAL setAAD, update/final concatenated, and a key that arrives
// as `Uint8Array | KeyObject`.
import { createCipheriv, createDecipheriv, createSecretKey, randomBytes } from "node:crypto";
import * as crypto from "node:crypto";

const key = Buffer.from("0123456789abcdef0123456789abcdef", "utf8"); // 32 bytes
const iv16 = Buffer.from("0123456789abcdef", "utf8");
const nonce12 = Buffer.from("0123456789ab", "utf8");
const EMPTY = Buffer.alloc(0);

function show(tag: string, head: Buffer, tail: Buffer): void {
  console.log(tag, head.length, tail.length, Buffer.concat([head, tail]).toString("hex"));
}

// ── CTR: a stream cipher, so update returns everything and final none ──
for (const n of [0, 1, 15, 16, 17, 40, 64]) {
  const pt = Buffer.alloc(n);
  for (let i = 0; i < n; i++) pt[i] = (i * 7 + 3) & 0xff;
  const c = createCipheriv("aes-256-ctr", key, iv16);
  show("ctr", c.update(pt), c.final());
  const d = createDecipheriv("aes-256-ctr", key, iv16);
  const e = createCipheriv("aes-256-ctr", key, iv16);
  const ct = Buffer.concat([e.update(pt), e.final()]);
  show("ctr-back", d.update(ct), d.final());
}

// ── CBC: PKCS#7, so final always carries a block and update lags ──────
for (const n of [0, 1, 15, 16, 17, 31, 32, 33, 64]) {
  const pt = Buffer.alloc(n);
  for (let i = 0; i < n; i++) pt[i] = (i * 5 + 11) & 0xff;
  const c = createCipheriv("aes-256-cbc", key, iv16);
  const head = c.update(pt);
  const tail = c.final();
  show("cbc", head, tail);
  const ct = Buffer.concat([head, tail]);
  const d = createDecipheriv("aes-256-cbc", key, iv16);
  show("cbc-back", d.update(ct), d.final());
}

// CBC fed in pieces: the split must not change what comes out overall, but
// it DOES change which call returns what, and both sides must agree.
const long = Buffer.alloc(70);
for (let i = 0; i < 70; i++) long[i] = (i * 3 + 1) & 0xff;
for (const cut of [1, 15, 16, 17, 33, 69]) {
  const c = createCipheriv("aes-256-cbc", key, iv16);
  const a = c.update(long.subarray(0, cut));
  const b = c.update(long.subarray(cut));
  const f = c.final();
  console.log("cbc-split", cut, a.length, b.length, f.length,
    Buffer.concat([a, b, f]).toString("hex"));
  const ct = Buffer.concat([a, b, f]);
  const d = createDecipheriv("aes-256-cbc", key, iv16);
  const da = d.update(ct.subarray(0, cut));
  const db = d.update(ct.subarray(cut));
  const df = d.final();
  console.log("cbc-split-back", cut, da.length, db.length, df.length,
    Buffer.concat([da, db, df]).toString("hex"));
}

// ── GCM: zapo's aesGcmEncrypt / aesGcmDecrypt, verbatim in shape ──────
function aesGcmEncrypt(k: Uint8Array | crypto.KeyObject, nonce: Uint8Array, plaintext: Uint8Array,
  aad: Uint8Array = EMPTY): Buffer {
  const cipher = createCipheriv("aes-256-gcm", k, nonce);
  if (aad.length > 0) {
    cipher.setAAD(aad);
  }
  const head = cipher.update(plaintext);
  const tail = cipher.final();
  const tag = cipher.getAuthTag();
  console.log("gcm-parts", head.length, tail.length, tag.length);
  return Buffer.concat([head, tail, tag]);
}
function aesGcmDecrypt(k: Uint8Array | crypto.KeyObject, nonce: Uint8Array, ciphertext: Uint8Array,
  aad: Uint8Array = EMPTY): Buffer {
  const tagOffset = ciphertext.length - 16;
  const tag = ciphertext.subarray(tagOffset);
  const ct = ciphertext.subarray(0, tagOffset);
  const decipher = createDecipheriv("aes-256-gcm", k, nonce);
  if (aad.length > 0) {
    decipher.setAAD(aad);
  }
  decipher.setAuthTag(tag);
  const head = decipher.update(ct);
  const tail = decipher.final();
  console.log("gcm-back-parts", head.length, tail.length);
  return Buffer.concat([head, tail]);
}

// A Buffer key and a KeyObject key through the SAME `Uint8Array | KeyObject`
// parameter — the arm is chosen at runtime, and both must agree.
const secret = createSecretKey(key);
for (const n of [0, 1, 16, 33, 64]) {
  const pt = Buffer.alloc(n);
  for (let i = 0; i < n; i++) pt[i] = (i * 11 + 2) & 0xff;
  const withBytes = aesGcmEncrypt(key, nonce12, pt);
  const withKeyObj = aesGcmEncrypt(secret, nonce12, pt);
  console.log("gcm", n, withBytes.toString("hex"));
  console.log("gcm-same-through-both-arms", withBytes.equals(withKeyObj));
  console.log("gcm-back", aesGcmDecrypt(secret, nonce12, withBytes).toString("hex"));
}

// AAD, present and absent, at several lengths.
for (const a of [1, 13, 16, 40]) {
  const aad = Buffer.alloc(a);
  for (let i = 0; i < a; i++) aad[i] = (i * 17 + 4) & 0xff;
  const pt = Buffer.from("the quick brown fox jumps over the lazy dog", "utf8");
  const ct = aesGcmEncrypt(key, nonce12, pt, aad);
  console.log("gcm-aad", a, ct.toString("hex"));
  console.log("gcm-aad-back", aesGcmDecrypt(key, nonce12, ct, aad).toString("utf8"));
}

// A wrong tag must throw, and a wrong AAD must throw — the whole point of
// the mode. Node's message differs by build, so only the throw is pinned.
const good = aesGcmEncrypt(key, nonce12, Buffer.from("secret", "utf8"), Buffer.from("bind", "utf8"));
try {
  aesGcmDecrypt(key, nonce12, good, Buffer.from("different", "utf8"));
  console.log("gcm wrong aad did not throw");
} catch {
  console.log("gcm wrong aad threw");
}
const tampered = Buffer.from(good);
const lastT = tampered.length - 1;
tampered[lastT] ^= 1;
try {
  aesGcmDecrypt(key, nonce12, tampered, Buffer.from("bind", "utf8"));
  console.log("gcm wrong tag did not throw");
} catch {
  console.log("gcm wrong tag threw");
}

// A corrupted CBC pad must throw too.
const cbc = createCipheriv("aes-256-cbc", key, iv16);
const ctcbc = Buffer.concat([cbc.update(Buffer.from("padded", "utf8")), cbc.final()]);
const lastC = ctcbc.length - 1;
ctcbc[lastC] ^= 0xff;
try {
  const d = createDecipheriv("aes-256-cbc", key, iv16);
  Buffer.concat([d.update(ctcbc), d.final()]);
  console.log("cbc bad pad did not throw");
} catch {
  console.log("cbc bad pad threw");
}

// Wrong key and IV lengths are refused at construction.
try {
  createCipheriv("aes-256-cbc", Buffer.alloc(16), iv16);
  console.log("short key did not throw");
} catch {
  console.log("short key threw");
}
try {
  createCipheriv("aes-256-cbc", key, Buffer.alloc(12));
  console.log("short iv did not throw");
} catch {
  console.log("short iv threw");
}

// A random round trip, to be sure nothing above accidentally pinned a
// degenerate key.
const rk = randomBytes(32);
const riv = randomBytes(16);
const rpt = randomBytes(100);
const rc = createCipheriv("aes-256-cbc", rk, riv);
const rct = Buffer.concat([rc.update(rpt), rc.final()]);
const rd = createDecipheriv("aes-256-cbc", rk, riv);
console.log("random round trip", Buffer.concat([rd.update(rct), rd.final()]).equals(rpt));
