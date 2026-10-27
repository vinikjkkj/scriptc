// parent and offset answer undefined on the prototype; a Buffer is an instance of the prototype's constructor.
var P = Buffer.prototype
console.log(P.parent, P.offset, 'parent' in P, 'offset' in P)
var b = Buffer.from('xy')
console.log(b instanceof Buffer, Buffer.isBuffer(b))
console.log(Object.keys(P).length, P.hasOwnProperty("readUInt8"))
