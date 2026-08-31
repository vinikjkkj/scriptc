// The 16-bit kinds through every operation whose arithmetic multiplies by
// the element size: subarray (aliasing), slice (independent), set at an
// offset, fill with a range, sort, iteration, spread — plus the DataView
// interaction, because a DataView over a 16-bit array's buffer is where
// the runtime's byte view and its element view have to agree.
const a = new Int16Array([1, 2, 3, 4, 5, 6]);

const sub = a.subarray(1, 4);
console.log("sub", sub.length, sub.byteLength);
sub[0] = -99;
console.log("alias", a[1], sub[0]);

const cp = a.slice(1, 4);
cp[0] = 7;
console.log("copy", a[1], cp[0], cp.length, cp.byteLength);

const dst = new Int16Array(6);
dst.set(a.subarray(2, 5), 1);
for (let i = 0; i < dst.length; i++) console.log("set", i, dst[i]);

a.fill(5, 2, 4);
for (let i = 0; i < a.length; i++) console.log("fill", i, a[i]);

const s = new Int16Array([3, -32768, 32767, 0, -1, 100]);
s.sort();
for (let i = 0; i < s.length; i++) console.log("sort", i, s[i]);

const us = new Uint16Array([3, 65535, 0, 1, 32768]);
us.sort();
for (let i = 0; i < us.length; i++) console.log("usort", i, us[i]);

for (const v of us) console.log("iter", v);
console.log("spread", [...us].join(","));

// DataView over a 16-bit array's storage. getInt16 defaults to BIG-endian
// and getInt16(0, true) is little — the one place in this file where the
// byte order is observable without going through a Uint8Array.
const d = new Int16Array([258]);
const dv = new DataView(d.buffer);
console.log("dv", dv.byteLength, dv.getInt16(0), dv.getInt16(0, true));
console.log("dvu", dv.getUint16(0), dv.getUint16(0, true));
dv.setInt16(0, -2);
console.log("dv set be", d[0]);
dv.setInt16(0, -2, true);
console.log("dv set le", d[0]);

// The reverse direction: a 16-bit view is not what a DataView is, and the
// element read through each sees the same bytes.
const raw = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
const rdv = new DataView(raw.buffer);
console.log("raw", rdv.getInt16(0), rdv.getInt16(0, true), rdv.getUint16(2), rdv.getUint16(2, true));

// The shape zapo's audio path has: PCM samples clamped into Int16 range
// and handed on as bytes.
function toPcm(samples: number[]): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    let v = Math.round(samples[i]! * 32767);
    if (v > 32767) v = 32767;
    if (v < -32768) v = -32768;
    out[i] = v;
  }
  return out;
}
const pcm = toPcm([0, 0.5, -0.5, 1, -1, 1.5, -1.5]);
for (let i = 0; i < pcm.length; i++) console.log("pcm", i, pcm[i]);
const pcmBytes = new Uint8Array(pcm.buffer);
let sum = 0;
for (let i = 0; i < pcmBytes.length; i++) sum += pcmBytes[i]!;
console.log("pcm bytes", pcmBytes.length, "sum", sum);
