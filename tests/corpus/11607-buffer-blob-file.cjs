// The buffer module's Blob and File classes: size, type, slice, the File name and lastModified, and
// the promise reads text() and bytes() (settled in a later turn, after the already queued reactions).
var Blob = require('buffer').Blob
var File = require('buffer').File
var b = new Blob(['ab', 'c'], { type: 'Text/Plain' })
console.log(b.size, b.type, b.slice(1).size, b.slice(-2, 3).type)
var f = new File(['x'], 'a.txt', { type: 'text/plain', lastModified: 5 })
console.log(f.name, f.lastModified, f.size, f.type)
b.text().then(function (t) { console.log('text', t) })
Promise.resolve('plain').then(function (v) { console.log('plain', v) })
console.log('sync')
