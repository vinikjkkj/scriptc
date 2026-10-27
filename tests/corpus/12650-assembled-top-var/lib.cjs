// The exporter assembles its export object at run time (for-in copies), so the member's static type is an object with no mapping.
function Buf(n, fill) { this.len = n; this.fill = fill }
Buf.from = function (s, enc) { return { text: String(s), enc: enc === undefined ? 'utf8' : enc } }
Buf.alloc = function (n, fill) { return new Buf(n, fill === undefined ? 0 : fill) }
Buf.isBuffer = function (x) { return x instanceof Buf }
var api = {}
for (var k in { Buffer: Buf }) api[k] = Buf
module.exports = api
