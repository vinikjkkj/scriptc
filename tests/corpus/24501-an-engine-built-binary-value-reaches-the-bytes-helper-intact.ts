/* eslint-disable @typescript-eslint/no-implied-eval -- the row builds engine code at run time on purpose */
// zapo store-mysql toBytes, whole: the engine builds the column value, the helper returns the bytes of whichever binary shape arrives.
function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error("expected binary data");
}
function tryBytes(value: unknown): string {
  try {
    const b = toBytes(value);
    return b.length + ":" + Array.from(b).join(",");
  } catch (e) {
    return (e as Error).message;
  }
}
const make = new Function(
  "return [new Uint8Array([3, 1, 4]), new Uint8Array([9, 8, 7, 6]).buffer, new Uint8Array(new Uint8Array([1, 2, 3, 4, 5]).buffer, 1, 3), new Uint8Array(0), new ArrayBuffer(0), 'text', null];",
) as () => unknown[];
console.log(JSON.stringify(make().map(tryBytes)));
const first = make()[0];
