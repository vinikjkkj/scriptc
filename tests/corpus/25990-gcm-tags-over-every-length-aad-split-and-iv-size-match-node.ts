// AES-256-GCM through the compiled runtime: tags and ciphertext over every plaintext length 0..70 and a few long ones, with and without AAD
// (0..40 bytes), with the plaintext fed whole and in uneven pieces, a 12-byte and a 16- and a 1-byte IV, a corrupted tag refused, and a
// round trip. GHASH is exercised on every block count, every partial tail and the AAD/ciphertext boundary.
import { createCipheriv, createDecipheriv } from "node:crypto";

const key = Buffer.alloc(32);
for (let i = 0; i < 32; i++) key[i] = (i * 11 + 5) & 0xff;
function bytes(n: number, seed: number): Buffer {
  const b = Buffer.alloc(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    b[i] = s >>> 24;
  }
  return b;
}
function enc(iv: Buffer, aad: Buffer, pt: Buffer, cuts: number[]): string {
  const c = createCipheriv("aes-256-gcm", key, iv);
  if (aad.length > 0) c.setAAD(aad);
  const parts: Buffer[] = [];
  let at = 0;
  for (const cut of cuts) {
    const to = Math.min(pt.length, at + cut);
    parts.push(c.update(pt.subarray(at, to)));
    at = to;
  }
  parts.push(c.update(pt.subarray(at)));
  parts.push(c.final());
  return Buffer.concat(parts).toString("hex") + " " + c.getAuthTag().toString("hex");
}
const iv12 = bytes(12, 7);
for (let n = 0; n <= 70; n++) {
  const pt = bytes(n, n + 1);
  const aad = bytes(n % 41, n + 99);
  console.log("gcm", n, enc(iv12, aad, pt, []), enc(iv12, Buffer.alloc(0), pt, [3, 13]));
}
for (const n of [255, 256, 257, 1000, 4096, 4099]) {
  const pt = bytes(n, n);
  console.log("long", n, enc(iv12, bytes(33, 5), pt, [1, 15, 16, 17, 100]).slice(-64));
}
for (const ivLen of [1, 12, 16, 20]) {
  console.log("iv", ivLen, enc(bytes(ivLen, ivLen), bytes(20, 3), bytes(50, 9), [7]));
}
// round trip and a refused tag
{
  const pt = bytes(333, 42);
  const aad = bytes(19, 8);
  const c = createCipheriv("aes-256-gcm", key, iv12);
  c.setAAD(aad);
  const ct = Buffer.concat([c.update(pt), c.final()]);
  const tag = c.getAuthTag();
  const d = createDecipheriv("aes-256-gcm", key, iv12);
  d.setAAD(aad);
  d.setAuthTag(tag);
  console.log("back", Buffer.concat([d.update(ct), d.final()]).equals(pt));
  const bad = Buffer.from(tag);
  bad[5] ^= 1;
  const d2 = createDecipheriv("aes-256-gcm", key, iv12);
  d2.setAAD(aad);
  d2.setAuthTag(bad);
  d2.update(ct);
  try { d2.final(); console.log("bad-tag accepted"); } catch (e) { console.log("bad-tag refused", (e as Error).message); }
}
