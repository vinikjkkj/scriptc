// Blob bytes(): a Uint8Array of the blob's bytes, read through the promise.
var Blob = require('buffer').Blob
var bs = new Blob([new Uint8Array([104, 105])])
console.log(bs.size)
bs.bytes().then(function (u) { console.log(u.length, u[0]) })
