// The two constructs that kept whole PROGRAMS off the LLVM backend, and
// the one thing each of them actually needed.
//
//  1. `createCipheriv`/`createDecipheriv`. Every other member of the
//     cipher family (update, final, setAAD, getAuthTag, setAuthTag) was
//     already in the LLVM tier's generic libCall table: their arguments
//     are 1:1 with the runtime's. The four CONSTRUCTORS were not, for one
//     reason — scr_cipher_new_bytes/scr_cipher_new_key take a trailing
//     `bool decrypt` that the IR does not carry as an argument, and the
//     generic path had no seat for an argument with no IR expression. The
//     C tier spells it inline (`scr_cipher_new_key(a, b, c, false)`); the
//     LLVM tier now appends the same constant.
//
//     So what this file has to pin is the CONSTANT, not the call. A
//     swapped `decrypt` flag compiles, links, and produces a handle — it
//     just builds the opposite transform. Every case below is directional:
//     the exact ciphertext hex (a decipher would produce different bytes,
//     or refuse the padding), the CBC round trip, the GCM tag, and the two
//     calls that are legal in one direction only.
//
//  2. Bigint LITERALS. The LLVM emitter refused every one of them with
//     "the LLVM tier has no ScrBigInt ABI yet". There was no ABI to build:
//     `bigint` is one `ptr` there like every other refcounted kind, its
//     RC/trace/field adapters already existed, and all NINETEEN big.*
//     operations were already in the table. Only the literal — one
//     scr_big_parse of its own spelling, which is exactly what the C tier
//     emits — had no route. This file therefore spells literals in all
//     four bases, with separators, at both sides of the 64-bit edges, and
//     then puts them through the operations that were never the problem,
//     so that a wrong parse cannot hide behind a right operator.
//
// It passes on both backends and on Node. Before the change the LLVM lane
// REFUSED it (SC3001) and the differential scored it a skip; that is the
// regression this pins, in both directions.
import { createCipheriv, createDecipheriv, createSecretKey } from "node:crypto";
import * as crypto from "node:crypto";

const key = Buffer.from("0123456789abcdef0123456789abcdef", "utf8"); // 32 bytes
const iv16 = Buffer.from("fedcba9876543210", "utf8");
const nonce12 = Buffer.from("0011223344ab", "utf8");
const secret = createSecretKey(key);

// ── 1a. The exact ciphertext, through BOTH key arms ────────────────────
// A decipher built by mistake would print different bytes here (CTR is a
// stream cipher, so it would not even throw — it would silently produce
// the keystream applied the other way round on a value that is not a
// ciphertext). Both arms must agree with each other and with Node.
const plain = Buffer.from("the quick brown fox jumps over the lazy dog!!", "utf8"); // 44 bytes
// The algorithm has to be a LITERAL at each call (the lowering picks the
// runtime entry from it), so the two modes are spelled out rather than
// looped: CTR is a stream cipher (update returns everything) and CBC is
// PKCS#7-padded (final carries a block) — a swapped direction shows up
// differently in each.
const ctrBytes = createCipheriv("aes-256-ctr", key, iv16);
const ctCtr = Buffer.concat([ctrBytes.update(plain), ctrBytes.final()]);
const ctrKey = createCipheriv("aes-256-ctr", secret, iv16);
const ctCtrK = Buffer.concat([ctrKey.update(plain), ctrKey.final()]);
console.log("enc ctr", ctCtr.length, ctCtr.toString("hex"));
console.log("enc-arms-agree ctr", ctCtr.equals(ctCtrK));
const dCtr = createDecipheriv("aes-256-ctr", key, iv16);
const backCtr = Buffer.concat([dCtr.update(ctCtr), dCtr.final()]);
const dCtrK = createDecipheriv("aes-256-ctr", secret, iv16);
const backCtrK = Buffer.concat([dCtrK.update(ctCtrK), dCtrK.final()]);
console.log("dec ctr", backCtr.toString("utf8"));
console.log("dec-arms-agree ctr", backCtr.equals(backCtrK), backCtr.equals(plain));

const cbcBytes = createCipheriv("aes-256-cbc", key, iv16);
const ctCbc = Buffer.concat([cbcBytes.update(plain), cbcBytes.final()]);
const cbcKey = createCipheriv("aes-256-cbc", secret, iv16);
const ctCbcK = Buffer.concat([cbcKey.update(plain), cbcKey.final()]);
console.log("enc cbc", ctCbc.length, ctCbc.toString("hex"));
console.log("enc-arms-agree cbc", ctCbc.equals(ctCbcK));
const dCbc = createDecipheriv("aes-256-cbc", key, iv16);
const backCbc = Buffer.concat([dCbc.update(ctCbc), dCbc.final()]);
const dCbcK = createDecipheriv("aes-256-cbc", secret, iv16);
const backCbcK = Buffer.concat([dCbcK.update(ctCbcK), dCbcK.final()]);
console.log("dec cbc", backCbc.toString("utf8"));
console.log("dec-arms-agree cbc", backCbc.equals(backCbcK), backCbc.equals(plain));

// ── 1b. A call that is legal in ONE direction only ─────────────────────
// getAuthTag belongs to a CIPHER. A decipher built here by mistake would
// have nothing to hand back — and, before that, CBC's padding is the
// other asymmetry: an encrypt of 45 bytes is fine, while a decrypt of 45
// bytes is not a whole number of blocks and Node refuses it. Both are
// pinned, so a swapped constant cannot pass either.
const c1 = createCipheriv("aes-256-gcm", key, nonce12);
c1.update(plain);
c1.final();
console.log("cipher getAuthTag length", c1.getAuthTag().length);
try {
  const d1 = createDecipheriv("aes-256-cbc", secret, iv16);
  Buffer.concat([d1.update(plain), d1.final()]); // 45 bytes: not a block multiple
  console.log("decipher of a ragged length did not throw");
} catch {
  console.log("decipher of a ragged length threw");
}

// ── 1c. GCM end to end with AAD, keyed both ways ───────────────────────
function seal(k: Uint8Array | crypto.KeyObject, aad: Uint8Array, pt: Uint8Array): Buffer {
  const cipher = createCipheriv("aes-256-gcm", k, nonce12);
  cipher.setAAD(aad);
  const head = cipher.update(pt);
  const tail = cipher.final();
  return Buffer.concat([head, tail, cipher.getAuthTag()]);
}
function open(k: Uint8Array | crypto.KeyObject, aad: Uint8Array, sealed: Uint8Array): string {
  const cut = sealed.length - 16;
  const decipher = createDecipheriv("aes-256-gcm", k, nonce12);
  decipher.setAAD(aad);
  decipher.setAuthTag(sealed.subarray(cut));
  const head = decipher.update(sealed.subarray(0, cut));
  return Buffer.concat([head, decipher.final()]).toString("utf8");
}
const aad = Buffer.from("bind-me", "utf8");
for (const n of [0, 1, 16, 45]) {
  const pt = Buffer.alloc(n);
  for (let i = 0; i < n; i++) pt[i] = (i * 13 + 5) & 0xff;
  const a = seal(key, aad, pt);
  const b = seal(secret, aad, pt);
  console.log("gcm", n, a.length, a.toString("hex"));
  console.log("gcm-arms-agree", n, a.equals(b));
  console.log("gcm-open", n, open(secret, aad, a) === pt.toString("utf8"));
}
// A tampered tag must fail to authenticate — the decipher really is a
// decipher, and it really is checking.
const sealed = seal(key, aad, Buffer.from("payload", "utf8"));
const bad = Buffer.from(sealed);
const lastByte = bad.length - 1;
bad[lastByte] ^= 1;
try {
  open(key, aad, bad);
  console.log("gcm tampered did not throw");
} catch {
  console.log("gcm tampered threw");
}

// ── 2a. Bigint literals: every base, separators, and the 64-bit edges ──
const dec = 1234567890123456789012345678901234567890n;
const hex = 0xdeadbeefcafebaben;
const oct = 0o7777777777777777777n;
const bin = 0b1010101010101010101010101010101010101010101010101010101010101010n;
const sep = 1_000_000_000_000_000_000_000n;
const zero = 0n;
const one = 1n;
// Radix 2..7 is deliberately ABSENT, and not because of this change:
// scr_big_to_str sizes its digit buffer `a->n * 11 + 2`, which is the
// DECIMAL bound (<= 9.63 digits per 32-bit limb). A radix r needs
// ceil(32 / log2 r) per limb, so 8/9/10/16/36 fit under 11 and 2..7 do
// not — `(2n ** 128n).toString(2)` writes 130 bytes into a 57-byte heap
// allocation. It is a pre-existing C-runtime overflow on main, unrelated
// to the LLVM tier, and a fixture that tripped it would be flaky rather
// than useful. repro and one-line fix in estado-llvmtier.md.
for (const b of [dec, hex, oct, bin, sep, zero, one]) {
  console.log("lit", b.toString(), b.toString(16), b.toString(36), b.toString(8));
}
// Both sides of every width edge a naive parse would get wrong.
const edges = [
  9223372036854775807n,
  9223372036854775808n,
  -9223372036854775808n,
  -9223372036854775809n,
  18446744073709551615n,
  18446744073709551616n,
  4294967295n,
  4294967296n,
  -0n,
];
for (const e of edges) console.log("edge", e.toString(), (e < 0n).toString(), (e === 0n).toString());

// ── 2b. The operations, over literal operands ──────────────────────────
const a1 = 0xffffffffffffffffn;
const b1 = 1000000007n;
console.log("add", (a1 + b1).toString());
console.log("sub", (a1 - b1).toString());
console.log("mul", (a1 * b1).toString());
console.log("div", (a1 / b1).toString());
console.log("rem", (a1 % b1).toString());
console.log("pow", (3n ** 100n).toString());
console.log("neg", (-a1).toString());
console.log("not", (~a1).toString());
console.log("and", (a1 & 0x0f0f0f0f0f0f0f0fn).toString());
console.log("or", (b1 | 0xff00n).toString());
console.log("xor", (a1 ^ b1).toString());
console.log("shl", (b1 << 40n).toString());
console.log("shr", (a1 >> 33n).toString());
console.log("cmp", (a1 > b1).toString(), (a1 < b1).toString(), (b1 === 1000000007n).toString());
console.log("conv", BigInt(42).toString(), Number(255n).toString());
console.log("asint", BigInt.asIntN(64, a1).toString(), BigInt.asUintN(32, a1).toString());

// A literal that survives a container, a capture box and a union arm —
// the paths where a wrongly-owned parse result would show up as a leak or
// a double free rather than as a wrong digit.
const list: bigint[] = [1n, 22n, 333n, 4444n];
console.log("arr", list.map((v) => v.toString()).join(","));
let acc = 0n;
const bump = (): void => {
  acc += 7n;
};
bump();
bump();
console.log("captured", acc.toString());
const maybe: bigint | undefined = list.length > 0 ? 99n : undefined;
console.log("union", maybe === undefined ? "none" : maybe.toString());
const back: unknown = 12345678901234567890n;
console.log("unknown", typeof back, String(back));
