// ISOLATED: the one shape that compiled on base and answered WRONG. No
// Int8Array and no 16-bit kind in this file, so nothing refuses first and
// masks it.
const one = new Float64Array(new ArrayBuffer(8))
console.log('f64', one.length, one.byteLength)
const two = new Float64Array(new ArrayBuffer(16))
console.log('f64x2', two.length, two.byteLength)
