// write(string, offset, length, encoding), write(string, encoding), and slice as a VIEW (Node's Buffer.slice is subarray).
var P = Buffer.prototype
var b = Buffer.alloc(6)
console.log(P.write.call(b, 'abc', 1), P.write.call(b, 'zz', 0, 2, 'latin1'), P.write.call(b, '6869', 4, 'hex'))
console.log(b.toString('latin1'))
var v = P.slice.call(b, 1, 3)
v[0] = 0x41
console.log(b[1], v.length, Buffer.isBuffer(v))
console.log(P.subarray.call(b, 2, 4).length, P.indexOf.call(b, 0x69), P.includes.call(b, 0x7a))
console.log(P.fill.call(Buffer.alloc(3), 0x2a).toString('hex'))
