// A function reads the binding before its declaration runs: Node reads undefined there.
function early() { return typeof Buffer }
console.log(early())
var Buffer = require('./lib.cjs').Buffer
console.log(early(), Buffer.size)
