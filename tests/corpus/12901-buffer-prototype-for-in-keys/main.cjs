// The for-in over Buffer.prototype: Node's 95 keys in Node's order, 93 of them functions.
var keys = []
for (var k in Buffer.prototype) keys.push(k)
console.log(keys.length)
console.log(keys.join(' '))
var fns = 0
for (var j in Buffer.prototype) if (typeof Buffer.prototype[j] === 'function') fns++
console.log(fns)
