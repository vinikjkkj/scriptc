// A straight-line f64 kernel over Float64Array elements held in locals: NaN, infinities, signed zero, division by zero, floor of negatives,
// compound updates, and NaN payloads that must never become scriptc's NaN-marked `undefined` or array hole (a forged 0x7ffc00000000de01 /
// ...de02 pattern in the bytes, a hole read out of a number[], a value returned out of the kernel). Every printed number is the double Node prints.
function kernel(o: Float64Array, a: Float64Array, b: Float64Array): void {
  const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
  const b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
  const v1 = 38 * b1, v2 = 38 * b2;
  let t0 = a0 * b0 + a1 * v2 + a2 * v1;
  let t1 = a0 * b1 + a1 * b0 - a3 * b3;
  let t2 = a2 / b2 + Math.floor(t0 / 65536);
  let c = Math.floor(t1 / 65536);
  t1 -= c * 65536;
  t2 += c;
  t0 = -t0 % 7;
  const t3 = a3 - a3 + Math.min(a1, b3) + Math.max(a0, b0);
  o[0] = t0;
  o[1] = t1;
  o[2] = t2;
  o[3] = c + t3;
}
function copyThrough(a: Float64Array, o: Float64Array): void {
  const x = a[0];
  o[0] = x;
  o[1] = x + 1;
}
function sum(a: Float64Array): number {
  let acc = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    acc += v * 2;
  }
  return acc;
}
function ret(a: Float64Array): number {
  const x = a[0];
  const y = x * 3;
  return y;
}
function retDirect(a: Float64Array): number {
  const x = a[1];
  return x + 1;
}
function holeRead(xs: number[], i: number): number {
  const x = xs[i];
  return x * 2 + 1;
}
function holeLocal(xs: number[]): string {
  const x = xs[1];
  const y = x + 0;
  const z = y * 1;
  return String(z) + "," + String(x);
}
// An f64 element read must answer a NaN for a forged marker pattern wherever the value is observed
function loadPrint(a: Float64Array): string {
  const x = a[0];
  return String(x) + "," + (x !== x) + "," + String(x + 0) + "," + (x === x);
}
function loadRet(a: Float64Array): number {
  return a[1];
}
function loadLocalRet(a: Float64Array): number {
  const x = a[2];
  return x;
}
function loadArg(a: Float64Array): string {
  return String(a[0]) + String(a[1]) + String(a[2]);
}
function loadEq(a: Float64Array): boolean {
  const x = a[0];
  const y = a[1];
  return x === y;
}
function loadCopy(a: Float64Array, o: Float64Array): string {
  o[0] = a[0];
  return String(o[0]) + (o[0] !== o[0]);
}
function show(o: Float64Array): string {
  let s = "";
  for (let i = 0; i < o.length; i++) s += (Object.is(o[i], -0) ? "-0" : String(o[i])) + " ";
  return s;
}

const cases: number[][] = [
  [1, 2, 3, 4, 5, 6, 7, 8],
  [65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535],
  [-1, -2, -3, -4, 5, 6, 7, 8],
  [0.5, 1.5, -2.5, 3.5, 4.5, -5.5, 6.5, 7.5],
  [NaN, 2, 3, 4, 5, 6, 7, 8],
  [1, 2, 3, 4, 5, NaN, 7, 8],
  [Infinity, 2, 3, 4, 5, 6, 7, -Infinity],
  [1, 2, 3, 4, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [-0, -0, -0, -0, 1, 1, 1, 1],
  [1e300, 1e300, 1e300, 1e300, 1e300, 1e300, 1e300, 1e300],
  [-1e-300, 1e-300, 5e-324, -5e-324, 2, 2, 2, 2],
];
const a = new Float64Array(4), b = new Float64Array(4), o = new Float64Array(4);
for (const c of cases) {
  for (let i = 0; i < 4; i++) { a[i] = c[i]!; b[i] = c[i + 4]!; }
  kernel(o, a, b);
  console.log(show(o), sum(a), ret(a), retDirect(b));
}
// NaN payloads: the NaN-marked undefined and hole patterns written as plain bytes, then read back as doubles
const bits = new Float64Array(4);
const raw = new DataView(bits.buffer);
const patterns: number[][] = [
  [0x01, 0xde, 0x00, 0x00, 0x00, 0x00, 0xfc, 0x7f],
  [0x02, 0xde, 0x00, 0x00, 0x00, 0x00, 0xfc, 0x7f],
  [0x01, 0xde, 0x00, 0x00, 0x00, 0x00, 0xfc, 0xff],
  [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf8, 0x7f],
];
for (const p of patterns) {
  for (let k = 0; k < 32; k++) raw.setUint8(k, p[k % 8]!);
  const out = new Float64Array(4);
  copyThrough(bits, out);
  console.log(String(out[1]), String(sum(bits)), String(ret(bits)), String(retDirect(bits)));
  kernel(out, bits, bits);
  console.log(show(out));
  console.log(loadPrint(bits), String(loadRet(bits)), String(loadLocalRet(bits)), loadArg(bits), loadEq(bits), loadCopy(bits, out));
}
// number[] holes and out-of-range reads
const holes: number[] = new Array<number>(3);
holes[0] = 1;
holes[2] = 3;
console.log(String(holeRead(holes, 1)), String(holeRead(holes, 0)), String(holeRead(holes, 2)), holeLocal(holes), holeLocal([1, 2, 3]));
