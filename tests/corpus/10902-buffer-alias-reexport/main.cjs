// A CJS module re-exports functions built on the Buffer class it obtained from require('buffer');
// the consumer calls them.
var codec = require('./codec.cjs')
var b = codec.make('hello')
console.log(b.length, codec.size(4), codec.check(b), codec.check('x'))
console.log(codec.hex(codec.make('ab')))
