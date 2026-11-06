/* eslint-disable @typescript-eslint/no-implied-eval -- the row builds engine code at run time on purpose */
// Every typed-array constructor (and DataView) as an instanceof test over an untyped value, for values the program built and values the engine built.
function k(v: unknown): string {
  const o: string[] = [];
  if (v instanceof Uint8Array) o.push("u8");
  if (v instanceof Uint8ClampedArray) o.push("u8c");
  if (v instanceof Int8Array) o.push("i8");
  if (v instanceof Int16Array) o.push("i16");
  if (v instanceof Uint16Array) o.push("u16");
  if (v instanceof Int32Array) o.push("i32");
  if (v instanceof Uint32Array) o.push("u32");
  if (v instanceof Float32Array) o.push("f32");
  if (v instanceof Float64Array) o.push("f64");
  if (v instanceof BigInt64Array) o.push("i64");
  if (v instanceof BigUint64Array) o.push("u64");
  if (v instanceof DataView) o.push("dv");
  if (ArrayBuffer.isView(v)) o.push("view");
  return o.join(",");
}
const native: unknown[] = [new Uint8Array(1), new Uint8ClampedArray(1), new Int8Array(1), new Int16Array(1), new Uint16Array(1), new Int32Array(1), new Uint32Array(1), new Float32Array(1), new Float64Array(1), new BigInt64Array(1), new BigUint64Array(1), new DataView(new Uint8Array(4).buffer), Buffer.from("a"), 5, null, {}];
console.log(JSON.stringify(native.map(k)));
const make = new Function(
  "return [new Uint8Array(1), new Uint8ClampedArray(1), new Int8Array(1), new Int16Array(1), new Uint16Array(1), new Int32Array(1), new Uint32Array(1), new Float32Array(1), new Float64Array(1), new BigInt64Array(1), new BigUint64Array(1), new DataView(new ArrayBuffer(4)), {}, 'x'];",
) as () => unknown[];
console.log(JSON.stringify(make().map(k)));
