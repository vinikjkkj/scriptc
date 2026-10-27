// Export object assembled at run time from the buffer module (for-in copies), then read by members.
var buffer = require('buffer')
var out = {}
var k
for (k in buffer) {
  if (!buffer.hasOwnProperty(k)) continue
  out[k] = buffer[k]
}
out.Buffer.marker = 'mine'
module.exports = out
