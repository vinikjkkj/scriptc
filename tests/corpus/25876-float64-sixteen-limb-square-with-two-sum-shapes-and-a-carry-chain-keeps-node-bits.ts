// A sixteen-limb schoolbook SQUARE over Float64Array limbs (the shape of a field squaring): the even sums read a[k] * a[k] and a[8+k] * v[8+k] besides the
// doubled products and the odd sums only the doubled ones, so the sums come in two shapes, followed by a serial Math.floor carry chain. Every limb comes out as
// the double Node computes, for ordinary limbs, limbs on the carry boundary, negative and fractional limbs, signed zeros, NaN, the infinities and denormals.
function sqr16(o: Float64Array, a: Float64Array): void {
  const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
  const a4 = a[4], a5 = a[5], a6 = a[6], a7 = a[7];
  const a8 = a[8], a9 = a[9], a10 = a[10], a11 = a[11];
  const a12 = a[12], a13 = a[13], a14 = a[14], a15 = a[15];
  const v8 = 38 * a8, v9 = 38 * a9, v10 = 38 * a10, v11 = 38 * a11, v12 = 38 * a12, v13 = 38 * a13, v14 = 38 * a14, v15 = 38 * a15;
  let t0 = a0 * a0 + a8 * v8 + 2 * (a1 * v15 + a2 * v14 + a3 * v13 + a4 * v12 + a5 * v11 + a6 * v10 + a7 * v9);
  let t1 = 2 * (a0 * a1 + a2 * v15 + a3 * v14 + a4 * v13 + a5 * v12 + a6 * v11 + a7 * v10 + a8 * v9);
  let t2 = a1 * a1 + a9 * v9 + 2 * (a0 * a2 + a3 * v15 + a4 * v14 + a5 * v13 + a6 * v12 + a7 * v11 + a8 * v10);
  let t3 = 2 * (a0 * a3 + a1 * a2 + a4 * v15 + a5 * v14 + a6 * v13 + a7 * v12 + a8 * v11 + a9 * v10);
  let t4 = a2 * a2 + a10 * v10 + 2 * (a0 * a4 + a1 * a3 + a5 * v15 + a6 * v14 + a7 * v13 + a8 * v12 + a9 * v11);
  let t5 = 2 * (a0 * a5 + a1 * a4 + a2 * a3 + a6 * v15 + a7 * v14 + a8 * v13 + a9 * v12 + a10 * v11);
  let t6 = a3 * a3 + a11 * v11 + 2 * (a0 * a6 + a1 * a5 + a2 * a4 + a7 * v15 + a8 * v14 + a9 * v13 + a10 * v12);
  let t7 = 2 * (a0 * a7 + a1 * a6 + a2 * a5 + a3 * a4 + a8 * v15 + a9 * v14 + a10 * v13 + a11 * v12);
  let t8 = a4 * a4 + a12 * v12 + 2 * (a0 * a8 + a1 * a7 + a2 * a6 + a3 * a5 + a9 * v15 + a10 * v14 + a11 * v13);
  let t9 = 2 * (a0 * a9 + a1 * a8 + a2 * a7 + a3 * a6 + a4 * a5 + a10 * v15 + a11 * v14 + a12 * v13);
  let t10 = a5 * a5 + a13 * v13 + 2 * (a0 * a10 + a1 * a9 + a2 * a8 + a3 * a7 + a4 * a6 + a11 * v15 + a12 * v14);
  let t11 = 2 * (a0 * a11 + a1 * a10 + a2 * a9 + a3 * a8 + a4 * a7 + a5 * a6 + a12 * v15 + a13 * v14);
  let t12 = a6 * a6 + a14 * v14 + 2 * (a0 * a12 + a1 * a11 + a2 * a10 + a3 * a9 + a4 * a8 + a5 * a7 + a13 * v15);
  let t13 = 2 * (a0 * a13 + a1 * a12 + a2 * a11 + a3 * a10 + a4 * a9 + a5 * a8 + a6 * a7 + a14 * v15);
  let t14 = a7 * a7 + a15 * v15 + 2 * (a0 * a14 + a1 * a13 + a2 * a12 + a3 * a11 + a4 * a10 + a5 * a9 + a6 * a8);
  let t15 = 2 * (a0 * a15 + a1 * a14 + a2 * a13 + a3 * a12 + a4 * a11 + a5 * a10 + a6 * a9 + a7 * a8);
  let c = Math.floor(t0 / 65536);
  t0 -= c * 65536;
  t1 += c;
  c = Math.floor(t1 / 65536);
  t1 -= c * 65536;
  t2 += c;
  c = Math.floor(t2 / 65536);
  t2 -= c * 65536;
  t3 += c;
  c = Math.floor(t3 / 65536);
  t3 -= c * 65536;
  t4 += c;
  c = Math.floor(t4 / 65536);
  t4 -= c * 65536;
  t5 += c;
  c = Math.floor(t5 / 65536);
  t5 -= c * 65536;
  t6 += c;
  c = Math.floor(t6 / 65536);
  t6 -= c * 65536;
  t7 += c;
  c = Math.floor(t7 / 65536);
  t7 -= c * 65536;
  t8 += c;
  c = Math.floor(t8 / 65536);
  t8 -= c * 65536;
  t9 += c;
  c = Math.floor(t9 / 65536);
  t9 -= c * 65536;
  t10 += c;
  c = Math.floor(t10 / 65536);
  t10 -= c * 65536;
  t11 += c;
  c = Math.floor(t11 / 65536);
  t11 -= c * 65536;
  t12 += c;
  c = Math.floor(t12 / 65536);
  t12 -= c * 65536;
  t13 += c;
  c = Math.floor(t13 / 65536);
  t13 -= c * 65536;
  t14 += c;
  c = Math.floor(t14 / 65536);
  t14 -= c * 65536;
  t15 += c;
  c = Math.floor(t15 / 65536);
  t15 -= c * 65536;
  t0 += 38 * c;
  o[0] = t0;
  o[1] = t1;
  o[2] = t2;
  o[3] = t3;
  o[4] = t4;
  o[5] = t5;
  o[6] = t6;
  o[7] = t7;
  o[8] = t8;
  o[9] = t9;
  o[10] = t10;
  o[11] = t11;
  o[12] = t12;
  o[13] = t13;
  o[14] = t14;
  o[15] = t15;
}
function bitsOf(o: Float64Array): string {
  const dv = new DataView(o.buffer, o.byteOffset, o.byteLength);
  let s = "";
  for (let i = 0; i < o.length; i++) s += (o[i] !== o[i] ? "nan" : dv.getUint32(i * 8 + 4).toString(16) + ":" + dv.getUint32(i * 8).toString(16)) + " ";
  return s;
}
function show(o: Float64Array): string {
  let s = "";
  for (let i = 0; i < o.length; i++) s += (Object.is(o[i], -0) ? "-0" : String(o[i])) + " ";
  return s;
}
const specials: number[] = [0, -0, 1, -1, 0.5, -0.5, 65535, 65536, -65536, 65535.5, 1e15, -1e15, 4503599627370496, 1e300, -1e300, 5e-324, NaN, Infinity, -Infinity, 38, 0.1];
const a = new Float64Array(16), o = new Float64Array(16);
let seed = 424242;
const next = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
for (let round = 0; round < 60; round++) {
  for (let i = 0; i < 16; i++) {
    a[i] = round < 20 ? next() % 65536 : round < 40 ? (next() % 131072) - 65536 + (next() % 4) / 4 : specials[next() % specials.length]!;
  }
  sqr16(o, a);
  console.log(round, show(o), bitsOf(o));
}
