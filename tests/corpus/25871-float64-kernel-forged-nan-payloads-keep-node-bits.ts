// A Float64Array kernel at its minimum length, over elements whose bytes are the NaN-marked `undefined` / array-hole patterns scriptc keeps in a number
// (forged through a DataView). Every element read into a local that reaches a copy, a
// compare, a rounding, a return or a string must answer a plain NaN.
function copyKernel(o: Float64Array, a: Float64Array): void {
  const x0 = a[0], x1 = a[1], x2 = a[2], x3 = a[3];
  o[0] = x0;
  o[1] = x1 + 1;
  o[2] = Math.floor(x2) * 2;
  o[3] = x3 < 1 ? 5 : 6;
}
function retKernel(o: Float64Array, a: Float64Array): number {
  const x0 = a[0], x1 = a[1], x2 = a[2], x3 = a[3];
  o[0] = x0 + x1;
  o[1] = x2 - x3;
  o[2] = x0 * x3;
  o[3] = x1 / x2;
  return x0;
}
function eqKernel(a: Float64Array): string {
  const x0 = a[0], x1 = a[1], x2 = a[2], x3 = a[3];
  return String(x0 === x1) + String(x2 === undefined) + String(x3 !== x3) + String(x0 == x3) + String(typeof x1);
}
function roundKernel(o: Float64Array, a: Float64Array): void {
  const x0 = a[0], x1 = a[1], x2 = a[2], x3 = a[3];
  o[0] = Math.floor(x0);
  o[1] = Math.trunc(x1);
  o[2] = Math.ceil(x2);
  o[3] = Math.floor(x3) + Math.trunc(x3) + Math.ceil(x3);
}
function show(o: Float64Array): string {
  let s = "";
  for (let i = 0; i < o.length; i++) s += (Object.is(o[i], -0) ? "-0" : String(o[i])) + " ";
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
  copyKernel(out, bits);
  console.log("copy", show(out), out[0] === undefined, typeof out[1], String(out[2]));
  const out2 = new Float64Array(4);
  console.log("ret", String(retKernel(out2, bits)), show(out2), out2[3] === undefined);
  console.log("eq", eqKernel(bits));
  const out3 = new Float64Array(4);
  roundKernel(out3, bits);
  console.log("round", show(out3));
}
