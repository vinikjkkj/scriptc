// The safer-buffer shape iconv-lite uses: `var Buffer = require("safer-buffer").Buffer`, then statics,
// for-in over the class, and instance methods. The module is safer.cjs (safer-buffer's assembly, see its header).
var Buffer = require('./safer.cjs').Buffer

var b = Buffer.from('abc')
console.log(typeof Buffer, b.length, Buffer.isBuffer(b), Buffer.isBuffer('abc'))
console.log(Buffer.from('6869', 'hex').toString(), Buffer.from('héllo').length)
var z = Buffer.alloc(3, 1)
console.log(z.length, z[0], z.toString('hex'), Buffer.alloc(2).toString('hex'))
console.log(Buffer.byteLength('héllo'), Buffer.compare(b, z), Buffer.isEncoding('utf8'))
console.log(Buffer.concat([b, z]).toString('hex'), Buffer.of(7, 8).toString('hex'))
console.log(Buffer.copyBytesFrom.length, typeof Buffer.poolSize)
console.log(Buffer.from('xy').toString('base64'), b.toString('utf8').length)
