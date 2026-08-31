// Int16Array: construction, length vs byteLength, element read-back.
const a = new Int16Array([1, -2, 3])
console.log(a.length, a.byteLength)
console.log(a[0], a[1], a[2])
const z = new Int16Array(4)
console.log(z.length, z.byteLength, z[0], z[3])
const e = new Int16Array(0)
console.log(e.length, e.byteLength)
