// The binding is read from an arrow closure and from a nested function, and its members are called there.
var lib = require('./lib.cjs')
var Buffer = lib.Buffer
var viaArrow = function () { return () => Buffer.from('a') }
function outer() { function inner() { return Buffer.alloc(2) } return inner() }
console.log(viaArrow()(), outer(), lib.tag, typeof Buffer)
var names = [1, 2].map(function (n) { return Buffer.alloc(n) })
console.log(names.join('|'))
