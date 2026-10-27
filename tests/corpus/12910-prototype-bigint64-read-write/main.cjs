// The 64-bit BigInt reads and writes of Buffer.prototype, as values and as instance calls.
var P = Buffer.prototype
var b = Buffer.from([1, 2, 3, 4, 5, 6, 7, 0x80])
console.log(P.readBigInt64LE.call(b, 0), P.readBigUInt64BE.call(b, 0), P.readBigUint64LE.call(b, 0), b.readBigInt64BE(0))
var w = Buffer.alloc(16)
console.log(P.writeBigInt64LE.call(w, -5n, 0), w.writeBigUInt64BE(12345678901234567890n, 8), w.toString('hex'))
console.log(w.readBigInt64LE(0), P.readBigUInt64BE.call(w, 8), typeof P.readBigInt64LE)
