// AES-256 block encryption through the compiled runtime under many different keys (a fresh key schedule each), in CBC (encrypt side: the block
// cipher is the chained step), CTR and GCM, over lengths around the block boundary, a counter that carries across a byte and a 32-bit word, and
// a long buffer. Every output is printed in full as hex.
import { createCipheriv, createDecipheriv } from "node:crypto";

function bytes(n: number, seed: number): Buffer {
  const b = Buffer.alloc(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    b[i] = s >>> 23;
  }
  return b;
}
for (let k = 0; k < 24; k++) {
  const key = bytes(32, 1000 + k);
  const iv = bytes(16, 2000 + k);
  const n = [0, 1, 15, 16, 17, 31, 32, 33, 47, 48, 255, 256, 257][k % 13]!;
  const pt = bytes(n, 3000 + k);
  const cbc = createCipheriv("aes-256-cbc", key, iv);
  const ct = Buffer.concat([cbc.update(pt), cbc.final()]);
  const back = createDecipheriv("aes-256-cbc", key, iv);
  const rt = Buffer.concat([back.update(ct), back.final()]);
  const ctr = createCipheriv("aes-256-ctr", key, iv);
  const cs = Buffer.concat([ctr.update(pt), ctr.final()]);
  const gcm = createCipheriv("aes-256-gcm", key, iv.subarray(0, 12));
  const gs = Buffer.concat([gcm.update(pt), gcm.final()]);
  console.log("k", k, n, ct.toString("hex"), rt.equals(pt), cs.toString("hex"), gs.toString("hex"), gcm.getAuthTag().toString("hex"));
}
// counters that carry: low byte 0xff, then a whole low word 0xffffffff
for (const tail of [[0xff], [0xff, 0xff, 0xff, 0xff], [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]]) {
  const iv = Buffer.alloc(16, 0x11);
  for (let i = 0; i < tail.length; i++) iv[15 - i] = tail[i]!;
  const c = createCipheriv("aes-256-ctr", bytes(32, 7), iv);
  console.log("carry", tail.length, Buffer.concat([c.update(Buffer.alloc(70)), c.final()]).toString("hex"));
}
const big = bytes(10000, 5);
const c = createCipheriv("aes-256-cbc", bytes(32, 8), bytes(16, 9));
console.log("big", Buffer.concat([c.update(big), c.final()]).subarray(-48).toString("hex"));
