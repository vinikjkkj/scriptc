// safer-buffer's shape: a plain holder object whose `Buffer.prototype` is the real Buffer.prototype.
var buffer = require('buffer')
var Buffer = buffer.Buffer
var safer = {}
var Safer = safer.Buffer = {}
var key
for (key in Buffer) {
  if (!Buffer.hasOwnProperty(key)) continue
  if (key === 'allocUnsafe' || key === 'allocUnsafeSlow') continue
  Safer[key] = Buffer[key]
}
safer.Buffer.prototype = Buffer.prototype
Safer.from = function (value) { return Buffer.from(value) }
module.exports = safer
