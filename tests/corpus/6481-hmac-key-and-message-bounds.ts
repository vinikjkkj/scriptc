// HMAC across the three lengths that select a different code path, and on
// both sides of the buffer bound the runtime uses.
//
// WHY THESE LENGTHS.
//   * the KEY: RFC 2104 replaces a key longer than the block with its own
//     digest, and pads a shorter one with zeros. The block is 64 for
//     sha1/sha256 and 128 for sha512, so 63/64/65 and 127/128/129 are six
//     different paths and an empty key is a seventh.
//   * the MESSAGE: the runtime builds `ipad || message` in a fixed stack
//     buffer and falls back to the heap past SCR_HMAC_INNER_STACK (512). A
//     message on each side of that bound is the only thing that keeps the
//     heap arm from being dead code that nothing ever proves.
//   * and the inner digest is always block+len bytes, so these lengths also
//     sweep the padding boundaries of the hash underneath.
import { createHmac } from "node:crypto";

function bytes(n: number, seed: number): Buffer {
  const b = Buffer.alloc(n);
  let x = (seed >>> 0) || 1;
  for (let i = 0; i < n; i += 1) {
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    b[i] = x & 0xff;
  }
  return b;
}

const keyLens = [0, 1, 16, 31, 32, 63, 64, 65, 100, 127, 128, 129, 200];
const msgLens = [0, 1, 31, 32, 55, 56, 63, 64, 65, 127, 128, 300, 333, 447, 448, 511, 512, 513, 1024, 4096];

for (let k = 0; k < keyLens.length; k += 1) {
  const key = bytes(keyLens[k]!, 11 + keyLens[k]!);
  for (let m = 0; m < msgLens.length; m += 1) {
    const msg = bytes(msgLens[m]!, 907 + msgLens[m]!);
    console.log(
      "256 " + keyLens[k] + " " + msgLens[m] + " " +
      createHmac("sha256", key).update(msg).digest("hex")
    );
  }
}

// sha512's block is 128, so the same message lengths land on a different
// side of the stack bound and on different padding boundaries.
for (let k = 0; k < keyLens.length; k += 1) {
  const key = bytes(keyLens[k]!, 21 + keyLens[k]!);
  for (let m = 0; m < msgLens.length; m += 1) {
    const msg = bytes(msgLens[m]!, 131 + msgLens[m]!);
    console.log(
      "512 " + keyLens[k] + " " + msgLens[m] + " " +
      createHmac("sha512", key).update(msg).digest("hex")
    );
  }
}

// sha1, which zapo's WebSocket handshake reaches, on the same key bounds.
for (let k = 0; k < keyLens.length; k += 1) {
  const key = bytes(keyLens[k]!, 41 + keyLens[k]!);
  console.log("1 " + keyLens[k] + " " + createHmac("sha1", key).update(bytes(70, 5)).digest("hex"));
}

// Streaming into an HMAC: many small updates must equal one big one, and
// the accumulated message must be able to cross the stack bound.
const big = bytes(900, 77);
for (const chunk of [1, 7, 64, 100, 511, 512, 900]) {
  const h = createHmac("sha256", bytes(32, 3));
  for (let off = 0; off < big.length; off += chunk) {
    h.update(big.subarray(off, Math.min(off + chunk, big.length)));
  }
  console.log("stream " + chunk + " " + h.digest("hex"));
}
console.log("oneshot " + createHmac("sha256", bytes(32, 3)).update(big).digest("hex"));

// No update at all, and the two non-hex encodings.
console.log("noupdate " + createHmac("sha256", bytes(32, 3)).digest("hex"));
console.log("b64 " + createHmac("sha256", bytes(32, 3)).update(bytes(50, 8)).digest("base64"));
console.log(
  "raw " +
    Buffer.from(createHmac("sha512", bytes(32, 3)).update(bytes(50, 8)).digest()).toString("hex")
);
