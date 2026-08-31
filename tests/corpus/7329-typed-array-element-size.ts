// BYTES_PER_ELEMENT at the one spelling that reads it: `new T(new
// ArrayBuffer(n))`, where the buffer never exists as a value and the
// element count is n / elementSize computed at COMPILE time.
//
// That divisor used to be the inline `elem === "u8" ? 1 : 4`, right for
// the three 4-byte kinds and wrong on both sides of them. It made
// `new Float64Array(new ArrayBuffer(8))` a TWO-element array with a
// byteLength of 16 — a silent wrong answer, not a refusal — and it
// refused `new Int8Array(new ArrayBuffer(3))` as "not divisible by 4"
// with advice that changes the program. Both rows below are that fix, and
// the 16-bit rows are the kinds the divisor had no entry for at all.
const one = new Float64Array(new ArrayBuffer(8));
console.log("f64", one.length, one.byteLength);
const two = new Float64Array(new ArrayBuffer(16));
console.log("f64x2", two.length, two.byteLength);

const i8 = new Int8Array(new ArrayBuffer(3));
console.log("i8", i8.length, i8.byteLength);
const u8 = new Uint8Array(new ArrayBuffer(3));
console.log("u8", u8.length, u8.byteLength);

const i16 = new Int16Array(new ArrayBuffer(6));
console.log("i16", i16.length, i16.byteLength);
i16[2] = -1;
console.log("i16 write", i16[0], i16[1], i16[2]);
const u16 = new Uint16Array(new ArrayBuffer(8));
console.log("u16", u16.length, u16.byteLength);
console.log("i16 empty", new Int16Array(new ArrayBuffer(0)).length);

const u32 = new Uint32Array(new ArrayBuffer(8));
console.log("u32", u32.length, u32.byteLength);
const f32 = new Float32Array(new ArrayBuffer(12));
console.log("f32", f32.length, f32.byteLength);
const i32 = new Int32Array(new ArrayBuffer(4));
console.log("i32", i32.length, i32.byteLength);
