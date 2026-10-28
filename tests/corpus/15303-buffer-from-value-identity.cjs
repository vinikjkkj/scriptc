// Identity of the stored Buffer.from value: every mention is the same function object.
var f = Buffer.from
var g = Buffer.from || Buffer
console.log(f === Buffer.from, Buffer.from === Buffer.from, g === Buffer.from, typeof g, g === Buffer)
console.log(f.length, f.name, typeof f)
var o = { from: Buffer.from }
console.log(o.from === f, o.from('ok').toString('hex'), f('ok').toString('hex'))
console.log(f.call(null, 'hi', 'hex').length, f.call(undefined, 'yo').toString())
var arr = [Buffer.from]
console.log(arr[0]('abc').length, arr[0] === f)
