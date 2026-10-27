// A user constructor whose prototype is Buffer.prototype: instances and real Buffers answer instanceof as Node does.
function W() {}
W.prototype = Buffer.prototype
var b = Buffer.from('ab')
console.log(b instanceof W, b instanceof Buffer, Buffer.isBuffer(b))
var w = new W()
console.log(w instanceof Buffer, w instanceof W, typeof w.readUInt8)
console.log({} instanceof Buffer, new Uint8Array(2) instanceof Buffer)
