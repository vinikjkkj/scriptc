// crypto.hkdfSync('sha256', ...) — RFC 5869 extract-then-expand, answering
// the ArrayBuffer Node answers. The salt is the HMAC KEY in extract, which
// is the step that produces plausible garbage rather than an error when it
// is wrong, so the RFC's own A.1 vector rides here. Node is the oracle for
// the derivations AND for the length ladder.
import { hkdfSync } from "node:crypto";

function hex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) {
    const v = b[i]!;
    s += (v < 16 ? "0" : "") + v.toString(16);
  }
  return s;
}

function caught(label: string, fn: () => string): void {
  try {
    console.log(label, "ok", fn());
  } catch (e) {
    if (e instanceof RangeError) {
      console.log(label, "RangeError:", e.message);
    } else if (e instanceof Error) {
      console.log(label, "Error:", e.message);
    } else {
      console.log(label, "unexpected");
    }
  }
}

// RFC 5869 A.1: ikm = 0x0b x 22, salt = 000102..0c, info = f0f1..f9, L = 42.
const ikm = new Uint8Array(22);
ikm.fill(0x0b);
const salt = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
const info = new Uint8Array([0xf0, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9]);
console.log("a1", hex(new Uint8Array(hkdfSync("sha256", ikm, salt, info, 42))));

// Empty salt and empty info — the shape a Noise mixKey uses.
const empty = new Uint8Array(0);
console.log("empty", hex(new Uint8Array(hkdfSync("sha256", ikm, empty, empty, 42))));

// Exactly one block, and the 64-byte split into two halves (the
// Signal/WhatsApp pair-key pattern).
console.log("one-block", hex(new Uint8Array(hkdfSync("sha256", ikm, salt, info, 32))));
const both = new Uint8Array(hkdfSync("sha256", ikm, salt, info, 64));
console.log("half-a", hex(both.subarray(0, 32)));
console.log("half-b", hex(both.subarray(32)));

// The smallest and largest accepted lengths.
console.log("len1", hex(new Uint8Array(hkdfSync("sha256", ikm, salt, info, 1))));
console.log("len8160", hex(new Uint8Array(hkdfSync("sha256", ikm, salt, info, 8160))).length);

// Node's length ladder, in Node's own order: non-integer first (NaN and the
// infinities among them), then bounds, then the ZERO length (OpenSSL's bare
// "Deriving bits failed", not a range error), then past 255*32.
caught("len0", () => hex(new Uint8Array(hkdfSync("sha256", ikm, salt, info, 0))));
caught("len-neg", () => hex(new Uint8Array(hkdfSync("sha256", ikm, salt, info, -1))));
caught("len-frac", () => hex(new Uint8Array(hkdfSync("sha256", ikm, salt, info, 1.5))));
caught("len-nan", () => hex(new Uint8Array(hkdfSync("sha256", ikm, salt, info, 0 / 0))));
caught("len-8161", () => hex(new Uint8Array(hkdfSync("sha256", ikm, salt, info, 8161))));

// The composed shape the caller actually writes: a view over the derived
// buffer, then a split. (The real toBytesView also asks
// `value.constructor === Uint8Array`, which keeps its fence — Buffer and
// Uint8Array are one representation here, so that predicate has no honest
// answer. The ArrayBuffer arm below is the one this call reaches.)
function toBytesView(value: Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}
function hkdf(k: Uint8Array, s: Uint8Array | null, i: Uint8Array, n: number): Uint8Array {
  return toBytesView(hkdfSync("sha256", k, s ?? empty, i, n));
}
console.log("composed-a", hex(hkdf(ikm, salt, info, 64).subarray(0, 32)));
console.log("composed-null-salt", hex(hkdf(ikm, null, info, 16)));

// RC stress: 100k derivations whose buffer dies right after the view.
let acc = 0;
for (let i = 0; i < 100000; i++) {
  const out = hkdf(ikm, salt, info, 32);
  acc += out[0]! + out[31]!;
}
console.log("stress", acc);
