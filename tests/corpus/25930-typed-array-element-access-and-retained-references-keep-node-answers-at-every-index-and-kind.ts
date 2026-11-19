// Element reads and writes on every typed-array kind at ordinary, edge and out-of-window indices and values, plus references retained through
// strings, arrays, unions, closures and untyped values that outlive the scope that made them.
function nz(v: number | undefined): string {
  return Object.is(v, -0) ? "-0" : String(v);
}
function rd8(a: Uint8Array, i: number): string { return nz(a[i]); }
function rdf(a: Float64Array, i: number): string { return nz(a[i]); }
function rdi(a: Int32Array, i: number): string { return nz(a[i]); }
function rdu(a: Uint32Array, i: number): string { return nz(a[i]); }
function rdg(a: Float32Array, i: number): string { return nz(a[i]); }
const u8 = new Uint8Array(8);
const f64 = new Float64Array(8);
const i32 = new Int32Array(8);
const u32 = new Uint32Array(8);
const f32 = new Float32Array(8);
const idx = [0, 1, 7, 8, -1, -0, 0.5, 1.5, NaN, Infinity, -Infinity, 2 ** 53, 2 ** 32, 3.0000000000000004, 1e300];
const vals = [0, 1, 255, 256, -1, -129, 3.7, -3.7, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 32 + 5, 2 ** 53, 2 ** 63, -(2 ** 63), 2 ** 64 + 2 ** 12, 1e300, -0, 0.1];
for (const k of idx) {
  for (const v of vals) {
    u8[k] = v; f64[k] = v; i32[k] = v; u32[k] = v; f32[k] = v;
  }
  console.log("idx", String(k), rd8(u8, k), rdf(f64, k), rdi(i32, k), rdu(u32, k), rdg(f32, k));
}
for (const v of vals) {
  for (let i = 0; i < 8; i++) { u8[i] = v; f64[i] = v; i32[i] = v; }
  console.log("val", String(v), Array.from(u8).join(","), Array.from(f64).map((x) => (Object.is(x, -0) ? "-0" : String(x))).join(","), Array.from(i32).join(","));
}
let sum = 0;
for (let r = 0; r < 3; r++) for (let i = 0; i < 8; i++) { u8[i] = i * 37 + r; f64[i] = i / 3 + r; sum += u8[i]! + f64[i]!; }
console.log("sum", sum);

// retained references
function keep(s: string, a: number[], u: string | number | null, f: () => string, d: any): () => string {
  const t = s; const b = a; const w = u; const g = f; const e = d;
  return () => t + b.length + String(w) + g() + JSON.stringify(e);
}
const fs: Array<() => string> = [];
for (let i = 0; i < 6; i++) {
  const arr = [i, i + 1];
  const un: string | number | null = i % 3 === 0 ? "s" + i : i % 3 === 1 ? i : null;
  const dyn: any = i % 2 === 0 ? { k: i, n: [i] } : [i, "x"];
  fs.push(keep("str" + i, arr, un, () => "<" + i + ">", dyn));
}
for (let i = 0; i < 6; i++) console.log("keep", fs[i]!());
const bufs: Uint8Array[] = [];
for (let i = 0; i < 4; i++) { const b = new Uint8Array(3); b[1] = i + 1; bufs.push(b); }
const shared = bufs[2]!; bufs.length = 0;
console.log("shared", shared[1], shared.length);
