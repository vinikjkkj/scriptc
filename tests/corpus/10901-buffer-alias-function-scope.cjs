// The same alias bound inside a function, called several times, and a copy of the statics
// taken through the alias in a different function (module-level plumbing, no storage).
function encode(s) {
  var Buffer = require('buffer').Buffer
  return Buffer.from(s, 'utf8')
}
function size(n) {
  const Buf = require('buffer').Buffer
  return Buf.alloc(n).length
}
var out = []
for (var i = 0; i < 3; i++) out.push(encode('ab' + i).length)
console.log(out.join(','), size(7), size(0))
console.log(encode('é').toString('hex'))
