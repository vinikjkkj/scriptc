// The 2-byte ALIGNMENT rule at the one spelling that reaches it: the
// syntactic `new T(new ArrayBuffer(n))`, where n must divide the element
// size. 6 bytes is three Int16s; 8 is four Uint16s.
const a = new Int16Array(new ArrayBuffer(6))
console.log(a.length, a.byteLength)
a[2] = -1
console.log(a[0], a[1], a[2])
const b = new Uint16Array(new ArrayBuffer(8))
console.log(b.length, b.byteLength)
const c = new Int16Array(new ArrayBuffer(0))
console.log(c.length, c.byteLength)
