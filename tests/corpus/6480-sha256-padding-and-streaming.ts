// SHA-256 across every padding boundary, and the streaming form against the
// one-shot form.
//
// WHY THESE LENGTHS. FIPS 180-4 appends 0x80, then zeros, then a 64-bit
// big-endian bit length, so 55 is the last message that fits in one block
// and 56 is the first that needs two; 119/120 is the same boundary one block
// up. A compression core with the state save hoisted out of its loop hashes
// "abc" correctly and every other one-block message, and first diverges at
// 56 — which is why this sweeps lengths instead of checking a vector. The
// same sweep also separates the two arms of the CPUID dispatch in
// scr_sha256_blocks: the vector arm processes whole blocks and the scalar
// arm processes them one at a time, so a length that needs two padding
// blocks exercises a path a single vector never reaches.
//
// The bytes are a deterministic xorshift so the input is not all one value:
// a byte-swap defect in the message schedule survives a message of 0x00.
import { createHash } from "node:crypto";

function bytes(n: number): Buffer {
  const b = Buffer.alloc(n);
  let x = 0x9e3779b9;
  for (let i = 0; i < n; i += 1) {
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    b[i] = x & 0xff;
  }
  return b;
}

// Every length 0..130: 0-55 one block, 56-63 two, 64-119 two, 120-127 three.
for (let n = 0; n <= 130; n += 1) {
  console.log(n + " " + createHash("sha256").update(bytes(n)).digest("hex"));
}

// Lengths past the first schedule reuse, and one that is a block multiple.
const bigger = [191, 192, 256, 1000, 1024, 4096];
for (let i = 0; i < bigger.length; i += 1) {
  const n = bigger[i]!;
  console.log("big " + n + " " + createHash("sha256").update(bytes(n)).digest("hex"));
}

// The FIPS long vector: one million 'a'. Its digest is the one published
// value here that does not depend on this file's own filler.
console.log("million " + createHash("sha256").update(Buffer.alloc(1000000, 0x61)).digest("hex"));

// Streaming must equal one-shot: split a 150-byte message (the size the
// messaging bench hashes) at EVERY position, including 0 and the end.
const msg = bytes(150);
for (let cut = 0; cut <= 150; cut += 1) {
  const h = createHash("sha256");
  h.update(msg.subarray(0, cut));
  h.update(msg.subarray(cut));
  console.log("split " + cut + " " + h.digest("hex"));
}

// Three chunks, straddling both block boundaries of a 200-byte message.
const long = bytes(200);
const cuts = [
  [0, 0],
  [1, 63],
  [55, 56],
  [63, 64],
  [64, 65],
  [64, 128],
  [119, 120],
  [127, 128],
  [128, 199],
  [200, 200],
];
for (let i = 0; i < cuts.length; i += 1) {
  const a = cuts[i]![0]!;
  const b = cuts[i]![1]!;
  const h = createHash("sha256");
  h.update(long.subarray(0, a));
  h.update(long.subarray(a, b));
  h.update(long.subarray(b));
  console.log("three " + a + "," + b + " " + h.digest("hex"));
}

// A single update of nothing, and no update at all.
console.log("empty " + createHash("sha256").digest("hex"));
console.log("empty-update " + createHash("sha256").update(Buffer.alloc(0)).digest("hex"));

// The same digests through the other two encodings, so a defect in the
// encoder cannot hide behind a correct hex string.
const forEnc = bytes(150);
console.log("b64 " + createHash("sha256").update(forEnc).digest("base64"));
console.log("raw " + Buffer.from(createHash("sha256").update(forEnc).digest()).toString("hex"));
