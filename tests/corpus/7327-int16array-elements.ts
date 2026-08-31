// Int16Array and Uint16Array: the element kinds the runtime had no size
// for at all (scr_bytes_elem_size answered 1, 4 or 8 and nothing in
// between), so neither type could be spelled. Int16Array is PCM audio's
// element, which is why zapo's voip/media path is typed in it.
//
// The write is ONE store for both kinds — ToInt16 and ToUint16 are the
// same sixteen bits of ToUint32's 2^32 residue — and only the READ
// reinterprets. So the wraparound rows below are the load-bearing ones:
// 70000 must read back 4464 signed and 4464 unsigned, -1 must read -1
// signed and 65535 unsigned, out of the same byte pair.
const nan = 0 / 0;
const inf = 1 / 0;

const a = new Int16Array([1, -2, 3]);
console.log("i16 len", a.length, a.byteLength);
console.log("i16 read", a[0], a[1], a[2]);

const z = new Int16Array(4);
console.log("i16 zeroed", z.length, z.byteLength, z[0], z[3]);
console.log("i16 empty", new Int16Array(0).length, new Int16Array(0).byteLength);

// Wraparound and the signed boundaries, through the SEED array.
const seeded = new Int16Array([70000, 32767, 32768, -32768, -32769, 65535, 65536, -1]);
for (let i = 0; i < seeded.length; i++) console.log("i16 seed", i, seeded[i]);

// The same coercions through an index STORE.
const w = new Int16Array(1);
const vals = [70000, 32768, -32769, 1.9, -1.9, 65536, nan, inf, -inf, -0, 0xffff, 1e10];
for (const v of vals) {
  w[0] = v;
  console.log("i16 store", w[0]);
}

// The unsigned twin over the same values.
const u = new Uint16Array([70000, 32767, 32768, -32768, -32769, 65535, 65536, -1]);
for (let i = 0; i < u.length; i++) console.log("u16 seed", i, u[i]);
const uw = new Uint16Array(1);
for (const v of vals) {
  uw[0] = v;
  console.log("u16 store", uw[0]);
}

// byteLength is length times TWO — the arithmetic a missing element size
// gets wrong, and the reason this program checks both on every value.
console.log("stride", new Int16Array(5).byteLength, new Uint16Array(5).byteLength);

// Little-endian byte order through .buffer.
const one = new Int16Array([1]);
const oneBytes = new Uint8Array(one.buffer);
console.log("endian", oneBytes.length, oneBytes[0], oneBytes[1]);
const two = new Int16Array([-1, 258]);
const twoBytes = new Uint8Array(two.buffer);
console.log("endian2", twoBytes.length, twoBytes[0], twoBytes[1], twoBytes[2], twoBytes[3]);

// instanceof discriminates the two 16-bit kinds from each other and from u8.
console.log("inst", a instanceof Int16Array, a instanceof Uint16Array, a instanceof Uint8Array);
console.log("inst u", u instanceof Uint16Array, u instanceof Int16Array);
