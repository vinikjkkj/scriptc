// Buffer obtained from the builtin module by a `var` binding (the safer-buffer shape:
// `var buffer = require('buffer'); var Buffer = buffer.Buffer`) and by a `const` binding
// of the module member, then used through its statics and instance methods.
var buffer = require('buffer')
var Buffer = buffer.Buffer

var b = Buffer.from('abc')
console.log(b.length, Buffer.isBuffer(b), Buffer.isBuffer('abc'))
var z = Buffer.alloc(3, 1)
console.log(z.length, z[0], z.toString('hex'))
console.log(Buffer.from('6869', 'hex').toString(), Buffer.byteLength('héllo'))
console.log(Buffer.concat([b, z]).length, Buffer.compare(b, b), Buffer.isEncoding('utf8'))

const B = require('buffer').Buffer
console.log(B.from([1, 2, 3]).toString('hex'), B.allocUnsafe(4).length, B.alloc(0).length)
console.log(require('buffer').Buffer.from('xy').toString('base64'))
