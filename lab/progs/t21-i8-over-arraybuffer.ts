// ISOLATED: the shape base REFUSED with advice that changes the program
// ("divisible by 4" for a 1-byte element). Node builds a 3-element array.
const i = new Int8Array(new ArrayBuffer(3))
console.log('i8', i.length, i.byteLength)
i[2] = -1
console.log('read', i[0], i[1], i[2])
