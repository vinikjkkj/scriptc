// The exporter's own local `Buffer` is the real Buffer class; the EXPORTED member `Buffer` is a different object.
// A consumer's `.Buffer` must read the export, not the same-named local.
var buffer = require('buffer')
var Buffer = buffer.Buffer
var api = {}
api.Buffer = { from: function (x) { return 'export-from:' + x }, tag: 'export' }
api.size = Buffer.alloc(4).length
module.exports = api
