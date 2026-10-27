var m = require('./assembled.cjs')
var B = m.Buffer
console.log(B === m.Buffer, typeof B, B.marker, m.kMaxLength > 0, typeof m.Blob)
console.log(B.from('hi').toString('hex'), B.isBuffer(B.alloc(1)), require('buffer').Buffer.marker)
var b2 = m.Buffer.alloc(2, 9)
console.log(b2.toString('hex'), Buffer.isBuffer(b2))
