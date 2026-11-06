/* eslint-disable @typescript-eslint/no-implied-eval -- the row builds engine code at run time on purpose */
// zapo store-mysql toBytes tests a value from the engine (a mysql2 BLOB column) with these three checks; the value is an untyped slot.
function kinds(value: unknown): string {
  const out: string[] = [];
  if (value instanceof Uint8Array) out.push("u8");
  if (value instanceof ArrayBuffer) out.push("buf");
  if (ArrayBuffer.isView(value)) out.push("view");
  return out.join("+");
}
const body = [
  "class Sub extends Uint8Array {}",
  "return [new Uint8Array([1, 2, 3]), new Uint8Array([4]).buffer, new Uint16Array(2), new Float32Array(1), new Uint8ClampedArray(2),",
  "  new Sub(2), new DataView(new ArrayBuffer(4)), new Int8Array(1), {}, [], 'x', 5, null];",
].join("\n");
const make = new Function(body) as () => unknown[];
console.log(JSON.stringify(make().map(kinds)));
console.log(JSON.stringify([kinds(new Uint8Array(1)), kinds(new Uint16Array(1)), kinds({})]));
