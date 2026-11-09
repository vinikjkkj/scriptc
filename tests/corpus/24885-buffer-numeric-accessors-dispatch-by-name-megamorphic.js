// Every Buffer numeric accessor reached through an UNTYPED receiver, by literal name and by a computed name that rotates through the whole
// family (a megamorphic call site), plus names that are NOT accessors but share their prefixes, a name that is a different method of the
// same family of letters, and non-Buffer receivers calling methods of the same names. The dispatch finds the row by name; every shape
// must answer as Node does.
const names = [
  "readUInt8", "readUint8", "readInt8", "readUInt16LE", "readUint16LE", "readUInt16BE", "readUint16BE", "readInt16LE", "readInt16BE",
  "readUInt32LE", "readUint32LE", "readUInt32BE", "readUint32BE", "readInt32LE", "readInt32BE", "readFloatLE", "readFloatBE",
  "readDoubleLE", "readDoubleBE",
];
const wnames = [
  "writeUInt8", "writeUint8", "writeInt8", "writeUInt16LE", "writeUint16LE", "writeUInt16BE", "writeUint16BE", "writeInt16LE", "writeInt16BE",
  "writeUInt32LE", "writeUint32LE", "writeUInt32BE", "writeUint32BE", "writeInt32LE", "writeInt32BE", "writeFloatLE", "writeFloatBE",
  "writeDoubleLE", "writeDoubleBE",
];
function rotate(buf, rounds) {
  const out = [];
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < wnames.length; i++) {
      const w = wnames[(i + r) % wnames.length];
      const rd = names[(i + r) % names.length];
      buf[w](i + r + 1, 0);
      out.push(buf[rd](0));
    }
  }
  return out.join(",");
}
console.log(rotate(Buffer.alloc(16), 3));
function literal(buf) {
  buf.writeUInt8(200, 0); buf.writeInt8(-5, 1); buf.writeUInt16LE(0xabcd, 2); buf.writeUInt16BE(0xabcd, 4); buf.writeInt16LE(-300, 6);
  buf.writeUInt32LE(0xdeadbeef, 8);
  return [buf.readUInt8(0), buf.readInt8(1), buf.readUInt16LE(2), buf.readUInt16BE(4), buf.readInt16LE(6), buf.readUInt32LE(8), buf.readUint8(0), buf.readUint32BE(8)].join("|");
}
console.log(literal(Buffer.alloc(16)));
// variable-width family and names that look like accessors but are not
function varwidth(buf) {
  buf.writeUIntLE(0x123456, 0, 3); buf.writeUIntBE(0x123456, 3, 3); buf.writeIntLE(-1000, 6, 2); buf.writeIntBE(-1000, 8, 2);
  return [buf.readUIntLE(0, 3), buf.readUintBE(3, 3), buf.readIntLE(6, 2), buf.readIntBE(8, 2)].join("|");
}
console.log(varwidth(Buffer.alloc(12)));
function notAccessors(buf) {
  const probe = ["readUInt8x", "readUInt", "writeUInt", "read", "readUInt8 ", "", "readuint8", "writeUInt64LE", "readFloat"];
  return probe.map((n) => typeof buf[n]).join(",");
}
console.log(notAccessors(Buffer.alloc(16)));
// non-Buffer receivers: a Uint8Array has no accessors; an array/object/string receiver must not reach the Buffer table
function typeOfName(x, n) {
  return typeof x[n];
}
function others() {
  const u8 = new Uint8Array(4);
  const o = JSON.parse('{"readUInt8":1}');
  const a = JSON.parse("[1,2]");
  return [typeOfName(u8, "readUInt8"), typeOfName(u8, "writeUInt8"), typeOfName(o, "readUInt8"), typeOfName(a, "readUInt8"), typeOfName("s", "readUInt8")].join(",");
}
console.log(others());
function badArgs(buf) {
  const r = [];
  for (const f of [() => buf.readUInt8(99), () => buf.writeUInt8(300, 0), () => buf.readUInt32LE(14), () => buf.writeInt8(1, -1)]) {
    try { r.push(String(f())); } catch (e) { r.push(e.code + ":" + e.name); }
  }
  return r.join(",");
}
console.log(badArgs(Buffer.alloc(16)));
// the iterator names tested first on every typed-array receiver
const b4 = Buffer.from([1, 2, 3]);
function iter(x, n) {
  return [...x[n]()].join(";");
}
console.log(iter(b4, "keys"), iter(b4, "values"), iter(b4, "entries"), typeOfName(b4, "indexOf"), typeOfName(b4, "includes"));
