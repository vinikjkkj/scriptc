// Owners whose storage sits at, just under and just over the sizes a runtime could keep beside the header, for every element width: contents, zero fill,
// views over them that outlive the owner's last name, copies, concatenation, string and base64 round trips, and many short-lived buffers in a row.
function sum8(b: Uint8Array): number { let s = 0; for (let i = 0; i < b.length; i++) s = (s * 31 + b[i]!) >>> 0; return s; }
const sizes = [0, 1, 2, 7, 8, 9, 63, 64, 65, 127, 128, 129, 255, 256, 257, 511, 512, 513, 1024];
for (const n of sizes) {
  const u8 = new Uint8Array(n);
  for (let i = 0; i < n; i++) u8[i] = (i * 7 + 3) & 255;
  const u16 = new Uint16Array(n);
  const u32 = new Uint32Array(n);
  const f64 = new Float64Array(n);
  const i16 = new Int16Array(n);
  for (let i = 0; i < n; i++) { u16[i] = i * 3; u32[i] = i * 100003; f64[i] = i / 4; i16[i] = -i; }
  let z = 0;
  const zero = new Uint8Array(n);
  for (let i = 0; i < n; i++) z += zero[i]!;
  const copy = new Uint8Array(u8);
  copy[0] = 99;
  console.log(n, sum8(u8), u8.length, z, u16.length ? u16[n - 1] : -1, u32.length ? u32[n - 1] : -1, f64.length ? f64[n - 1] : -1, i16.length ? i16[n - 1] : -1, copy.length ? copy[0] : -1, u8.length ? u8[0] : -1);
}
// a view outlives the name of its owner
function viewOf(n: number): Uint8Array {
  const own = new Uint8Array(n);
  for (let i = 0; i < n; i++) own[i] = (i ^ 0x55) & 255;
  return own.subarray(1, n - 1);
}
for (const n of [3, 10, 100, 500, 513, 2000]) {
  const v = viewOf(n);
  let churn = 0;
  for (let k = 0; k < 50; k++) { const t = new Uint8Array(n); t[0] = k; churn += t[0]!; }
  console.log(n, v.length, sum8(v), v[0], v[v.length - 1], churn);
}
const dv = (() => { const b = new Uint8Array(40); for (let i = 0; i < 40; i++) b[i] = i; return new DataView(b.buffer, 4, 20); })();
console.log(dv.byteLength, dv.getUint8(0), dv.getUint8(19), dv.getUint16(2, true));
// Buffer: from string, base64, hex, concat, slice, alloc
const parts: Buffer[] = [];
for (let i = 0; i < 40; i++) parts.push(Buffer.from("part-" + i + "-é日", "utf8"));
const cat = Buffer.concat(parts);
console.log(cat.length, cat.toString("base64").length, cat.toString("hex").slice(0, 24), Buffer.from(cat.toString("base64"), "base64").equals(cat));
console.log(Buffer.alloc(0).length, Buffer.alloc(5, 7).toString("hex"), sum8(Buffer.alloc(600, 1)), Buffer.from("abc").subarray(1).toString());
const big = Buffer.alloc(700);
for (let i = 0; i < 700; i++) big[i] = i & 255;
const sl = big.subarray(300, 310);
console.log(sl.toString("hex"), big.slice(698).toString("hex"));
