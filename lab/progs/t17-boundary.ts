// The signed/unsigned boundaries named in the brief, read back through
// BOTH kinds over the SAME bytes.
const i = new Int16Array([32767, -32768, -1, 0])
const u = new Uint16Array(4)
const ub = new Uint8Array(i.buffer)
const ib2 = new Uint8Array(u.buffer)
for (let k = 0; k < ub.length; k++) ib2[k] = ub[k]!
for (let k = 0; k < 4; k++) console.log('signed', i[k], 'unsigned', u[k])
// -1 >>> 0 style coercion through the array
const c = new Uint16Array(2)
c[0] = -1 >>> 0
c[1] = (-1 >>> 0) + 1
console.log('coerced', c[0], c[1])
const d = new Int16Array(1)
d[0] = 0xffff
console.log('0xffff as i16', d[0])
