/* eslint-disable @typescript-eslint/no-explicit-any -- the row reads members off untyped values on purpose */
// zapo's toBytesView (util/bytes.ts) reads `.constructor` off a Buffer and off a Uint8Array: a Buffer is a subclass, a Uint8Array is plain.
function toBytesView(value: any): string {
  if (value instanceof Uint8Array) return value.constructor === Uint8Array ? "same" : "wrapped";
  return "other";
}
const items: any[] = [Buffer.from([1, 2, 3]), new Uint8Array([4, 5]), Buffer.alloc(0), { a: 1 }, [1], "str"];
console.log(items.map(toBytesView).join(","));
for (const v of items.slice(0, 3)) {
  console.log(v.constructor === Buffer, v.constructor === Uint8Array, v.constructor.name, typeof v.constructor);
}
console.log(items[0].constructor === items[2].constructor, items[0].constructor === items[1].constructor);
