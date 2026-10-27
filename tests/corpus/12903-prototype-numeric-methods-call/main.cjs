// The numeric methods of Buffer.prototype, called through .call on a Buffer and on a plain Uint8Array.
var P = Buffer.prototype
var b = Buffer.alloc(8)
console.log(P.writeUInt16BE.call(b, 0xbeef, 0), P.writeInt32LE.call(b, -2, 2), P.writeFloatBE.call(b, 1.5, 4))
console.log(b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7])
console.log(P.readUInt16BE.call(b, 0), P.readInt32LE.call(b, 2), P.readFloatBE.call(b, 4))
console.log(P.readUint8.call(new Uint8Array([7, 9]), 1), P.readDoubleLE.call(Buffer.alloc(8, 0x40), 0))
console.log(P.writeUIntLE.call(b, 0x1234, 0, 3), P.readUIntLE.call(b, 0, 3), P.readIntBE.call(b, 0, 2))
try { P.readUInt8.call(b, 9) } catch (e) { console.log(e.name, e.code, e.message) }
try { P.writeUInt8.call(b, 300, 0) } catch (e) { console.log(e.name, e.code, e.message) }
