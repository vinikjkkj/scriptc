// An eight-limb schoolbook multiply over Float64Array limbs (eight long independent sums, then a serial carry chain of Math.floor, the shape of a field
// multiply): every limb comes out as the double Node computes, for ordinary limbs, limbs near the carry boundary, negative and fractional limbs, signed
// zeros, NaN, the infinities and denormals. The output is printed by value and, for every number, by its bits (a NaN's sign and payload are the hardware's and are not compared).
function mul8(o: Float64Array, a: Float64Array, b: Float64Array): void {
  const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5], a6 = a[6], a7 = a[7];
  const b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3], b4 = b[4], b5 = b[5], b6 = b[6], b7 = b[7];
  const v1 = 38 * b1, v2 = 38 * b2, v3 = 38 * b3, v4 = 38 * b4, v5 = 38 * b5, v6 = 38 * b6, v7 = 38 * b7;
  let t0 = a0 * b0 + a1 * v7 + a2 * v6 + a3 * v5 + a4 * v4 + a5 * v3 + a6 * v2 + a7 * v1;
  let t1 = a0 * b1 + a1 * b0 + a2 * v7 + a3 * v6 + a4 * v5 + a5 * v4 + a6 * v3 + a7 * v2;
  let t2 = a0 * b2 + a1 * b1 + a2 * b0 + a3 * v7 + a4 * v6 + a5 * v5 + a6 * v4 + a7 * v3;
  let t3 = a0 * b3 + a1 * b2 + a2 * b1 + a3 * b0 + a4 * v7 + a5 * v6 + a6 * v5 + a7 * v4;
  let t4 = a0 * b4 + a1 * b3 + a2 * b2 + a3 * b1 + a4 * b0 + a5 * v7 + a6 * v6 + a7 * v5;
  let t5 = a0 * b5 + a1 * b4 + a2 * b3 + a3 * b2 + a4 * b1 + a5 * b0 + a6 * v7 + a7 * v6;
  let t6 = a0 * b6 + a1 * b5 + a2 * b4 + a3 * b3 + a4 * b2 + a5 * b1 + a6 * b0 + a7 * v7;
  let t7 = a0 * b7 + a1 * b6 + a2 * b5 + a3 * b4 + a4 * b3 + a5 * b2 + a6 * b1 + a7 * b0;
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
  t0 += 38 * c;
  o[0] = t0;
  o[1] = t1;
  o[2] = t2;
  o[3] = t3;
  o[4] = t4;
  o[5] = t5;
  o[6] = t6;
  o[7] = t7;
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
const a = new Float64Array(8), b = new Float64Array(8), o = new Float64Array(8);
let seed = 12345;
const next = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
for (let round = 0; round < 60; round++) {
  for (let i = 0; i < 8; i++) {
    a[i] = round < 20 ? next() % 65536 : round < 40 ? (next() % 131072) - 65536 + (next() % 4) / 4 : specials[next() % specials.length]!;
    b[i] = round < 20 ? next() % 65536 : round < 40 ? (next() % 131072) - 65536 - (next() % 4) / 8 : specials[next() % specials.length]!;
  }
  mul8(o, a, b);
  console.log(round, show(o), bitsOf(o));
}
