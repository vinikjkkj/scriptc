"use strict";
// mysql2's isJSON (lib/packets/encode_parameter.js): a Buffer parameter is not JSON because its constructor is not Object; and the
// constructor/prototype relations of a Buffer and a Uint8Array.
function isJSON(value) {
  return Array.isArray(value) || value.constructor === Object || (typeof value.toJSON === "function" && !Buffer.isBuffer(value));
}
const items = [Buffer.from([1, 2, 3]), new Uint8Array([4, 5]), Buffer.alloc(0), [1], "str"];
const out = [];
for (const item of items) out.push(isJSON(item));
console.log(out.join(","));
const b = Buffer.from([9]);
const u = new Uint8Array([9]);
console.log(Buffer.prototype instanceof Uint8Array, b instanceof Buffer, u instanceof Buffer, b instanceof Uint8Array, u instanceof Uint8Array);
console.log(b.constructor === Buffer, u.constructor === Uint8Array, b.constructor === Uint8Array, u.constructor === Buffer);
console.log(Buffer.name, Uint8Array.name);
