// The builtin Buffer class read as a VALUE: stored in a record, typeof is "function" (it was the
// string "string" when the class was an identity token), the stored reference is the global, and its
// statics answer through the stored reference.
var o = {}
o.B = Buffer
console.log(typeof o.B, o.B === Buffer)
console.log(typeof o.B.from, o.B.from('ab').toString('hex'))
var m = { B: Buffer }
console.log(m.B.alloc(2).length, m.B.isBuffer(m.B.from('x')), m.B.byteLength('abc'))
