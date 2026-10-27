// A top-level var initialised from a require member is reassigned inside a function; later reads see the new value.
var Buffer = require('./lib.cjs').Buffer
function swap(v) { Buffer = v }
console.log(Buffer.name)
swap({ name: 'b' })
function show() { return Buffer.name }
console.log(show())
