// A WebCrypto value stored into a field of an any-typed record.
const o = JSON.parse('{}')
const s = require('crypto').webcrypto.subtle
o.s = s
console.log(o)
