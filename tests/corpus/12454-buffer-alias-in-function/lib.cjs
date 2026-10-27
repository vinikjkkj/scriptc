// A dynamic export object with a Buffer member copied from the builtin module.
var buffer = require('buffer')
var out = {}
var k
for (k in buffer) { if (buffer.hasOwnProperty(k)) out[k] = buffer[k] }
out.Buffer = out.Buffer
module.exports = out
