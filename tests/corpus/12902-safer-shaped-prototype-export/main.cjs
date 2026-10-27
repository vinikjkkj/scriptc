// A consumer of the holder: the prototype it stores is the same object, and its methods work on a Buffer.
var safer = require('./lib.cjs')
var Buffer = require('buffer').Buffer
console.log(safer.Buffer.prototype === Buffer.prototype)
var b = safer.Buffer.from('hi')
console.log(b.toString('hex'), Buffer.isBuffer(b))
console.log(typeof safer.Buffer.prototype.readUInt8, safer.Buffer.prototype.readUInt8 === Buffer.prototype.readUInt8)
var n = 0
for (var k in safer.Buffer.prototype) n++
console.log(n)
