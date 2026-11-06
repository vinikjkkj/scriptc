/* eslint-disable @typescript-eslint/no-implied-eval -- the row builds engine code at run time on purpose */
// An engine typed array in an untyped slot, read back as the typed array it is: the bytes copy out with the element type kept.
const make = new Function(
  "return [new Float32Array([1.5, 2.5]), new Int16Array([-1, 7, 9]), new Uint32Array([4000000000, 1]), new Float64Array([0.25]), new Int8Array([-5, 5]), new Uint16Array(new Uint16Array([1, 2, 3, 4]).buffer, 2, 2)];",
) as () => unknown[];
const m = make();
const f32 = m[0] as Float32Array;
const i16 = m[1] as Int16Array;
const u32 = m[2] as Uint32Array;
const f64 = m[3] as Float64Array;
const i8 = m[4] as Int8Array;
const u16 = m[5] as Uint16Array;
console.log(JSON.stringify([f32.length, f32[0], f32[1], i16.length, i16[0], i16[1], i16[2], u32.length, u32[0], u32[1], f64.length, f64[0], i8[0], i8[1], u16.length, u16[0], u16[1]]));
