// The encoding slices and writes of Buffer.prototype, called as values and as instance methods.
var P = Buffer.prototype
var b = Buffer.from('héllo')
console.log(P.utf8Slice.call(b, 0, 3), P.hexSlice.call(b, 0, 4), P.latin1Slice.call(b, 1, 3))
console.log(P.base64Slice.call(b, 0, 3), P.asciiSlice.call(b, 0, 5), P.ucs2Slice.call(b, 0, 4))
console.log(b.utf8Slice(0, 3), b.hexSlice(1, 3), b.base64urlSlice(0, 4))
var w = Buffer.alloc(8)
console.log(P.utf8Write.call(w, 'hi', 0), P.hexWrite.call(w, 'ff00', 2), P.latin1Write.call(w, 'AB', 4, 2))
console.log(w.toString('hex'), w.utf8Write('x', 7))
