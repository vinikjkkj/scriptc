// equals, compare, copy and the swap family, called through the prototype with an explicit receiver.
var P = Buffer.prototype
var a = Buffer.from([1, 2, 3, 4])
var c = Buffer.from([1, 2, 9])
console.log(P.equals.call(a, Buffer.from([1, 2, 3, 4])), P.equals.call(a, c))
console.log(P.compare.call(a, c), P.compare.call(c, a), P.compare.call(a, Buffer.from([1, 2, 3, 4])))
var t = Buffer.alloc(6)
console.log(P.copy.call(a, t, 1, 0, 3), t[0], t[1], t[2], t[3], t[4], t[5])
console.log(typeof P.swap16.call(Buffer.from([1, 2, 3, 4]), undefined))
var s = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])
P.swap32.call(s)
console.log(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7])
P.swap64.call(s)
console.log(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7])
try { P.swap16.call(Buffer.from([1, 2, 3])) } catch (e) { console.log(e.name, e.code) }
