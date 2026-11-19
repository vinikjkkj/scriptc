// An element of a Float64Array whose bytes are the NaN-marked `undefined` / hole pattern (forged through a DataView), read DIRECTLY as an operand: stored
// back through arithmetic, returned from arithmetic, compared, rounded, converted to a string, bit-masked. Each answers what Node answers (NaN, never undefined).
function store(o: Float64Array, a: Float64Array): void {
  o[0] = a[0] * 2;
  o[1] = a[1] + a[2];
  o[2] = Math.floor(a[3]) - a[0];
  o[3] = -a[1];
}
function ret(a: Float64Array): number {
  return a[0] * 3 + a[1];
}
function retNeg(a: Float64Array): number {
  return -a[2];
}
function cmp(a: Float64Array): string {
  return String(a[0] < 1) + String(a[1] >= a[2]) + String(a[3] * 1 === a[3] * 1) + String((a[0] + 1) !== (a[0] + 1));
}
function text(a: Float64Array): string {
  return String(a[0] * 1) + "," + String(a[1] + 0) + "," + (a[2] / 1) + "," + `${Math.trunc(a[3])}`;
}
function mask(a: Float64Array): number {
  return (a[0] & 255) + (a[1] | 0) + (a[2] >>> 0) + (a[3] << 1);
}
function show(o: Float64Array): string {
  let s = "";
  for (let i = 0; i < o.length; i++) s += (Object.is(o[i], -0) ? "-0" : String(o[i])) + (o[i] === undefined ? "!" : "") + " ";
  return s;
}
const bits = new Float64Array(4);
const raw = new DataView(bits.buffer);
const patterns: number[][] = [
  [0x01, 0xde, 0x00, 0x00, 0x00, 0x00, 0xfc, 0x7f],
  [0x02, 0xde, 0x00, 0x00, 0x00, 0x00, 0xfc, 0x7f],
  [0x01, 0xde, 0x00, 0x00, 0x00, 0x00, 0xfc, 0xff],
  [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf8, 0x7f],
  [0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0x7f],
];
for (const p of patterns) {
  for (let k = 0; k < 32; k++) raw.setUint8(k, p[k % 8]!);
  const out = new Float64Array(4);
  store(out, bits);
  console.log("store", show(out));
  console.log("ret", String(ret(bits)), String(retNeg(bits)), cmp(bits), text(bits), mask(bits));
}
