// `var B = require('buffer').Buffer` is the same function object as the global Buffer; its statics
// (from, alloc, isBuffer, byteLength, concat, compare, isEncoding) answer through the alias, and a
// record that holds the alias calls them through the record.
var B = require('buffer').Buffer
console.log(typeof B, B === Buffer, B.from('hi').toString('hex'), B.alloc(2).length, B.isBuffer(B.from('x')), B.byteLength('abc'))
var o = { B: B }
console.log(o.B.concat([B.from('a'), B.from('b')]).toString(), B.compare(B.from('a'), B.from('b')), B.isEncoding('utf8'))
