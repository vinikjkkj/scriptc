// value.toString(this.encoding, start, end) over an untyped receiver (pg-types binaryParsers): the runtime Buffer arm decides.
'use strict';
function Parser(enc) { this.encoding = enc; }
Parser.prototype.read = function (value, offset, length) {
  return value.toString(this.encoding, offset >> 3, (offset += (length << 3)) >> 3);
};
var p = new Parser('utf8');
var buf = Buffer.from('héllo wörld', 'utf8');
console.log(p.read(buf, 0, 6), new Parser('hex').read(buf, 8, 3), new Parser('UTF-16LE').read(buf, 0, 4).length);
try { new Parser('nope').read(buf, 0, 2); } catch (e) { console.log(String(e)); }
