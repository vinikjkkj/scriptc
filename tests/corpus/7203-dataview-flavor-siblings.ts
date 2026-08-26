// The predicates that share the flavor mechanism with `instanceof`.
//
// `x.constructor === Uint8Array` and `x.constructor === Buffer` used to be
// each other's negation, which was exact while a u8 value could only be a
// Uint8Array or a Buffer. It stopped being exact the moment DataView got a
// flavor: the question is three-way now, so the Uint8Array side reads the
// POSITIVE fact (bytes.isPlainU8) instead of negating the Buffer one.
//
// `Buffer.isBuffer(dataView)` answered with a runtime THROW before -- the
// value carried no flavor, so no answer was honest. It carries one now and
// the answer is Node's plain `false`.
const owner = new Uint8Array([1, 2, 3, 4]);
const dv = new DataView(owner.buffer, 1, 2);
const u8 = new Uint8Array([7, 7]);
const buf = Buffer.from([8, 8]);

console.log(ArrayBuffer.isView(dv), ArrayBuffer.isView(u8), ArrayBuffer.isView(buf));
console.log(Buffer.isBuffer(dv), Buffer.isBuffer(u8), Buffer.isBuffer(buf));
console.log(dv.constructor === Uint8Array, u8.constructor === Uint8Array, buf.constructor === Uint8Array);
console.log(dv.constructor !== Uint8Array, u8.constructor !== Uint8Array);
console.log(typeof dv, Array.isArray(dv));

// A view built over a FRESH buffer takes the same stamp as one built over
// an existing owner's storage -- both spellings of `new DataView` go
// through the one producer that knows.
const fresh = new DataView(new ArrayBuffer(4));
console.log(fresh instanceof Uint8Array, Buffer.isBuffer(fresh), fresh.byteLength);

fresh.setUint16(0, 0xbeef, false);
console.log(fresh.getUint8(0), fresh.getUint8(1), fresh.getUint16(0, false));
