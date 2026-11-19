// Math.floor / trunc / ceil over the edges of the rounding windows (2^51 for the magic-number floor and ceil, 2^52 where doubles stop having fractions,
// 2^63 for the int64 cast of trunc): every answer has the same BITS
// as Node, signed zeros, NaN, the infinities and every double at or past 2^63 included, from a straight-line Float64Array kernel and from plain locals.
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
function bitsOf(o: Float64Array): string {
  const dv = new DataView(o.buffer, o.byteOffset, o.byteLength);
  let s = "";
  for (let i = 0; i < o.length; i++) s += dv.getUint32(i * 8 + 4).toString(16) + ":" + dv.getUint32(i * 8).toString(16) + " ";
  return s;
}
// rounding edges
const E = 9223372036854775808;
const edges: number[] = [
  0, -0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2.5, -2.5, 0.49999999999999994, -0.49999999999999994, 4503599627370495.5, -4503599627370495.5,
  2251799813685247.5, 2251799813685248.5, -2251799813685247.5, -2251799813685248.5, 2251799813685249.5, 3377699720527872.5, -3377699720527872.5,
  4503599627370496, 9007199254740991, 9007199254740992, -9007199254740992, 4611686018427387904, 9223372036854774784, -9223372036854774784,
  E, -E, E * 2, -E * 2, 1e300, -1e300, 5e-324, -5e-324, 1e-300, Infinity, -Infinity, NaN, 0.1, -0.1, 123456.789, -123456.789, 65535.99999999999,
  -65536.00000000001, 2147483647.5, -2147483648.5, 4294967296.5, 1.7976931348623157e308,
];
const inp = new Float64Array(4), outp = new Float64Array(4);
for (let i = 0; i < edges.length; i += 4) {
  for (let j = 0; j < 4; j++) inp[j] = edges[(i + j) % edges.length]!;
  roundKernel(outp, inp);
  console.log("edge", show(inp), "=>", bitsOf(outp));
}
for (const e of edges) {
  console.log("one", Object.is(Math.floor(e), -0), Math.floor(e), Math.trunc(e), Math.ceil(e), Math.floor(e / 3), Math.ceil(e * 7), Math.trunc(-e));
}
