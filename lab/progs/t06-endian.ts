// Endianness through .buffer: [1,0] on little-endian.
const a = new Int16Array([1])
const u = new Uint8Array(a.buffer)
console.log(u.length, u[0], u[1])
const b = new Int16Array([-1, 258])
const v = new Uint8Array(b.buffer)
console.log(v.length, v[0], v[1], v[2], v[3])
