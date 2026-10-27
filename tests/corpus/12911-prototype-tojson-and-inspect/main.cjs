// toJSON answers Node's { type: 'Buffer', data } object; inspect answers <Buffer ...> with the 50-byte cap.
var P = Buffer.prototype
var b = Buffer.from([1, 2, 3, 4, 5, 6, 7, 0x80])
console.log(JSON.stringify(P.toJSON.call(b)), JSON.stringify(b.toJSON()), JSON.stringify(Buffer.alloc(0).toJSON()))
console.log(Buffer.from('ab').toJSON().data.length, P.toJSON.call(Buffer.from('ab')).type)
console.log(P.inspect.call(Buffer.alloc(60, 0x61)))
console.log(P.inspect.call(Buffer.alloc(0)), '|', P.inspect.call(Buffer.from([0xff, 0x10])))
console.log(b.inspect())
