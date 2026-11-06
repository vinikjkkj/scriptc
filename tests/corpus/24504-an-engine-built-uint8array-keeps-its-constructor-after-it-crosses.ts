/* eslint-disable @typescript-eslint/no-implied-eval -- the row builds engine code at run time on purpose */
// zapo toBytesView after toBytes: a BLOB column value the engine built crosses as bytes, then its constructor is compared with Uint8Array.
function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  throw new Error("expected binary data");
}
function toBytesView(value: Uint8Array): Uint8Array {
  return value.constructor === Uint8Array ? value : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}
const make = new Function(
  "return [new Uint8Array([1, 2, 3]), new Uint8Array(new Uint8Array([9, 8, 7, 6, 5]).buffer, 1, 3), new Uint8Array(0)];",
) as () => unknown[];
const out: (boolean | number | string)[][] = [];
for (const v of make()) {
  const b = toBytes(v);
  const w = toBytesView(b);
  out.push([b.constructor === Uint8Array, w.length, Array.from(w).join(",")]);
}
console.log(JSON.stringify(out));
