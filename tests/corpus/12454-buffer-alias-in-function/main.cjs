// The alias is read inside a function and returned; statics and copies of the statics.
var lib = require('./lib.cjs')
function make(n) {
  var Buf = lib.Buffer
  var out = Buf.alloc(n, 5)
  return out
}
console.log(make(3).toString('hex'), lib.Buffer.from('ab').length)
var copy = lib.Buffer.from
console.log(copy('ok').toString(), copy === lib.Buffer.from)
console.log(Object.keys(lib.Buffer).length > 3)
