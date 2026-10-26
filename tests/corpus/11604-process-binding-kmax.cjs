// process.binding('buffer') answers kMaxLength (a number) and kStringMaxLength, read directly and
// through a stored record.
var kmax = process.binding('buffer').kMaxLength
console.log(typeof kmax, kmax > 0)
var sk = {}
sk.k = process.binding('buffer').kMaxLength
console.log(typeof sk.k, sk.k > 0, sk.k === kmax)
