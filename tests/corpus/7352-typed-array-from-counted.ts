// `Uint8Array.from({ length: n }, mapfn)` — the counted-generation idiom,
// and the one mapped form of the typed-array static whose answer is already
// built. It was SC2020 ("no scriptc lowering yet") on every typed array;
// zapo's WAM synthetic ids (`Uint8Array.from({ length: nBytes }, () =>
// Math.floor(Math.random() * 256))`) is the live consumer.
//
// ES2024 23.2.2.1: the source has no index properties, so every kValue is
// undefined and the mapper runs with (undefined, k) for k in 0..len-1, in
// order — exactly what `Array.from({ length: n }, mapfn)` does. Each result
// is then stored through the CONSTRUCTOR's element conversion, which is the
// same rule `new Uint8Array(number[])` applies (the last case is that
// control, in this same program).
//
// The lengths of what is covered are deliberate: the truncate-then-modulo
// ToUint8/ToInt16/... conversion at each constructor's own edge, a
// fractional and a negative length, and the mapper's call COUNT and index
// order — a lowering that built the array by any other route would have to
// get all three right too.

// 1. the shape the consumer writes
console.log("a1 " + Uint8Array.from({ length: 4 }, () => 7).join(","));
// 2. the index is the mapper's second argument
console.log("a2 " + Uint8Array.from({ length: 5 }, (_v, i) => i).join(","));
// 3. the FIRST argument is undefined — { length: n } has no index properties
console.log("a3 " + Uint8Array.from({ length: 3 }, (v, i) => (v === undefined ? i : 99)).join(","));
// 4. out-of-range results: truncate toward zero, then modulo
console.log("a4 " + Uint8Array.from({ length: 6 }, (_v, i) => i * 100).join(","));
console.log("a5 " + Uint8Array.from({ length: 4 }, (_v, i) => -i - 0.5).join(","));
console.log(
  "a6 " +
    Uint8Array.from({ length: 3 }, (_v, i) => (i === 0 ? NaN : i === 1 ? Infinity : -Infinity)).join(","),
);
console.log("a7 " + Uint8Array.from({ length: 3 }, (_v, i) => 255.9 + i).join(","));
// 5. length edge cases: zero, fractional (truncates), negative (empty)
console.log("a8 [" + Uint8Array.from({ length: 0 }, () => 1).join(",") + "]");
console.log("a9 " + Uint8Array.from({ length: 2.7 }, (_v, i) => i + 1).join(","));
console.log("a10 [" + Uint8Array.from({ length: -3 }, () => 1).join(",") + "]");
// 6. the mapper runs once per index, in index order
let calls = 0;
const order: number[] = [];
const r = Uint8Array.from({ length: 4 }, (_v, i) => {
  calls += 1;
  order[order.length] = i;
  return i * 2;
});
console.log("a11 " + r.join(",") + " calls=" + String(calls) + " order=" + order.join("-"));
// 7. a length read from a binding
const n = 5;
console.log("a12 " + Uint8Array.from({ length: n }, (_v, i) => 255 - i).join(","));

// 8. every sibling constructor, at its own conversion's edge
function s8(b: Int8Array): string {
  let o = "";
  for (let i = 0; i < b.length; i += 1) {
    if (i > 0) o += ",";
    o += String(b[i]);
  }
  return o;
}
function u16(b: Uint16Array): string {
  let o = "";
  for (let i = 0; i < b.length; i += 1) {
    if (i > 0) o += ",";
    o += String(b[i]);
  }
  return o;
}
function s16(b: Int16Array): string {
  let o = "";
  for (let i = 0; i < b.length; i += 1) {
    if (i > 0) o += ",";
    o += String(b[i]);
  }
  return o;
}
function u32(b: Uint32Array): string {
  let o = "";
  for (let i = 0; i < b.length; i += 1) {
    if (i > 0) o += ",";
    o += String(b[i]);
  }
  return o;
}
function s32(b: Int32Array): string {
  let o = "";
  for (let i = 0; i < b.length; i += 1) {
    if (i > 0) o += ",";
    o += String(b[i]);
  }
  return o;
}
function f32(b: Float32Array): string {
  let o = "";
  for (let i = 0; i < b.length; i += 1) {
    if (i > 0) o += ",";
    o += String(b[i]);
  }
  return o;
}
function f64(b: Float64Array): string {
  let o = "";
  for (let i = 0; i < b.length; i += 1) {
    if (i > 0) o += ",";
    o += String(b[i]);
  }
  return o;
}
console.log("b1 " + s8(Int8Array.from({ length: 4 }, (_v, i) => 126 + i)));
console.log("b2 " + u16(Uint16Array.from({ length: 3 }, (_v, i) => 65534 + i)));
console.log("b3 " + s16(Int16Array.from({ length: 3 }, (_v, i) => 32766 + i)));
console.log("b4 " + u32(Uint32Array.from({ length: 3 }, (_v, i) => 4294967294 + i)));
console.log("b5 " + s32(Int32Array.from({ length: 3 }, (_v, i) => 2147483646 + i)));
console.log("b6 " + f32(Float32Array.from({ length: 3 }, (_v, i) => 0.5 + i / 3)));
console.log("b7 " + f64(Float64Array.from({ length: 3 }, (_v, i) => 0.5 + i / 3)));

// 9. the CONTROL: the element conversion this lowering composes with
const ctl: number[] = [];
for (let i = 0; i < 6; i += 1) ctl[i] = i * 100;
console.log("c1 " + new Uint8Array(ctl).join(","));
// 10. the result is a real typed array, not the intermediate number[]
const t = Uint8Array.from({ length: 3 }, () => 1);
console.log("c2 " + String(t instanceof Uint8Array) + " " + String(t.byteLength) + " " + String(t.length));
