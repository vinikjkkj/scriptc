// for-in over the Buffer class enumerates its twelve enumerable statics in Node's order; the copied
// statics answer as functions through the copy.
var names = []
var key
for (key in Buffer) names.push(key)
console.log(names.length, names.join(','))
var copy = {}
for (key in Buffer) copy[key] = Buffer[key]
console.log(typeof copy.from, copy.from('ab').toString('hex'), copy.byteLength('abc'), copy.poolSize)
