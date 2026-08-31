// NaN / Infinity through the 16-bit coercion (ToUint32 residue, so 0).
const a = new Int16Array(4)
a[0] = NaN
a[1] = Infinity
a[2] = -Infinity
a[3] = -0
for (let i = 0; i < a.length; i++) console.log('i16', i, a[i], Object.is(a[i], -0))
const b = new Uint16Array(3)
b[0] = NaN
b[1] = Infinity
b[2] = -Infinity
for (let i = 0; i < b.length; i++) console.log('u16', i, b[i])
