// A buffer module member read twice is the same value (Node: one object per member), and a member
// stored in a record keeps identity with the module read.
var b = require('buffer')
var o = { x: b.transcode, c: b.constants }
console.log(typeof o.x, typeof o.c, o.x === b.transcode, o.c === b.constants, b.Buffer === b.Buffer)
