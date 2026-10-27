// Buffer.prototype identity, the function-valued methods, and the alias identities Node has.
var P = Buffer.prototype
console.log(P === Buffer.prototype, P === require('buffer').Buffer.prototype)
console.log(typeof P, typeof P.readUInt8, typeof P.writeDoubleBE, typeof P.toString)
console.log(P.constructor === Buffer, P.readUint8 === P.readUInt8, P.writeUint32LE === P.writeUInt32LE)
console.log(P.toLocaleString === P.toString, P.readUInt8 === P.writeUInt8)
console.log(P.readFloatLE.name, P.readFloatBE.name, P.readUInt16BE.name, P.readUint16BE.name)
console.log(P.readUIntLE.length, P.readInt8.length, P.writeIntBE.length, P.readFloatLE.length, P.writeDoubleLE.length)
var b = Buffer.from([1, 2, 3, 4])
console.log(b.readUInt8(0), P.readUInt8.call(b, 1))
