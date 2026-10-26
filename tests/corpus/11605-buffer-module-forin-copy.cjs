// safer-buffer's copy loop over the builtin buffer module: every enumerable key of require('buffer')
// is visited in Node's order (Buffer, SlowBuffer, transcode, isUtf8, isAscii, kMaxLength, ...), the
// copies are used as values, and the enumeration of the module itself is printed.
var buffer = require('buffer')
var safer = {}
var key
var names = []
for (key in buffer) names.push(key)
console.log(names.length, names.join(','))
for (key in buffer) {
  if (key === 'SlowBuffer' || key === 'Buffer') continue
  safer[key] = buffer[key]
}
console.log(typeof safer.kMaxLength, typeof safer.atob, safer.atob(safer.btoa('hi')))
console.log(safer.isUtf8(new Uint8Array([104, 105])), safer.constants.MAX_LENGTH > 0)
