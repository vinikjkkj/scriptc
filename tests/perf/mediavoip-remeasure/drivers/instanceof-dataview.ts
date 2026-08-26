// Which half of the toBytesView failure is it: does the compiled `instanceof`
// send a DataView into the `Uint8Array` branch, or is the isBuffer fence
// evaluated on a value that legitimately reached it?
//
// Oracle (node, and the TypeScript semantics): a DataView is NOT an instance of
// Uint8Array, so both lines below must print false / true respectively.
const backing = new Uint8Array([7, 8, 9, 10])
const dv: Uint8Array | ArrayBuffer | ArrayBufferView = new DataView(backing.buffer, 1, 2)
const u8: Uint8Array | ArrayBuffer | ArrayBufferView = new Uint8Array([1, 2, 3])

console.log('DataView   instanceof Uint8Array = ' + (dv instanceof Uint8Array ? 'true' : 'false') + '  (want false)')
console.log('Uint8Array instanceof Uint8Array = ' + (u8 instanceof Uint8Array ? 'true' : 'false') + '  (want true)')
console.log('INSTANCEOF-DATAVIEW: reached the end')
