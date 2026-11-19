// Float64Array kernels indexed by literals and counted loops, called with arrays of exactly the length they index, longer ones, SHORTER ones (an out-of-range read
// is undefined, so NaN in arithmetic; an out-of-range write is ignored) and aliased ones. Every printed number is the double Node prints.
function mul4(o: Float64Array, a: Float64Array, b: Float64Array): void {
  const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
  const b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
  o[0] = a0 * b0 + 38 * (a1 * b3 + a2 * b2 + a3 * b1);
  o[1] = a0 * b1 + a1 * b0 + 38 * (a2 * b3 + a3 * b2);
  o[2] = a0 * b2 + a1 * b1 + a2 * b0 + 38 * (a3 * b3);
  o[3] = a0 * b3 + a1 * b2 + a2 * b1 + a3 * b0;
}
function add16(o: Float64Array, a: Float64Array, b: Float64Array): void {
  for (let i = 0; i < 16; i++) o[i] = a[i] + b[i];
}
function sub16(o: Float64Array, a: Float64Array, b: Float64Array): void {
  for (let i = 0; i < 16; i++) o[i] = a[i] - b[i];
}
function neg15(o: Float64Array, a: Float64Array): void {
  for (let i = 0; i <= 14; i++) o[i] = 0 - a[i];
}
function shift(o: Float64Array, a: Float64Array): void {
  for (let i = 0; i < 15; i++) o[i] = a[i + 1] * 2 + a[i];
}
function back(o: Float64Array, a: Float64Array): void {
  for (let i = 1; i < 8; i++) o[i - 1] = a[i] - o[i];
  o[7] = a[0];
}
function show(o: Float64Array): string {
  let s = "";
  for (let i = 0; i < o.length; i++) s += (Object.is(o[i], -0) ? "-0" : String(o[i])) + " ";
  return s;
}
function fill(n: number, seed: number): Float64Array {
  const f = new Float64Array(n);
  for (let i = 0; i < n; i++) f[i] = ((i * 7919 + seed * 104729 + 13) % 65536) - 20000.5;
  return f;
}
for (const n of [3, 4, 5, 16]) {
  for (const m of [3, 4, 6]) {
    const o = fill(n, 1), a = fill(m, 2), b = fill(4, 3);
    mul4(o, a, b);
    console.log("mul4", n, m, show(o));
  }
}
for (const n of [0, 1, 15, 16, 17, 20]) {
  for (const m of [15, 16, 18]) {
    const o = fill(n, 4), a = fill(m, 5), b = fill(16, 6);
    add16(o, a, b);
    console.log("add16", n, m, show(o));
    sub16(o, b, a);
    console.log("sub16", n, m, show(o));
    const o2 = fill(n, 7);
    neg15(o2, fill(m, 8));
    console.log("neg15", n, m, show(o2));
    const o3 = fill(n, 9);
    shift(o3, fill(m, 10));
    console.log("shift", n, m, show(o3));
    const o4 = fill(Math.min(n, 8), 11);
    back(o4, fill(m > 8 ? 8 : m, 12));
    console.log("back", n, m, show(o4));
  }
}
// aliased receivers: the same array as output and both operands, and two views of one buffer
const s = fill(16, 13);
add16(s, s, s);
console.log("alias", show(s));
sub16(s, s, s);
console.log("alias0", show(s));
const buf = new Float64Array(24);
for (let i = 0; i < 24; i++) buf[i] = i + 0.25;
const lo = buf.subarray(0, 16), hi = buf.subarray(8, 24);
add16(hi, lo, hi);
console.log("views", show(buf));
shift(lo, hi);
console.log("views2", show(buf));
const v3 = buf.subarray(21);
mul4(v3, buf.subarray(0, 4), buf.subarray(20, 24));
console.log("short view", show(buf));
