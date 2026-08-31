// The same coercions through an index STORE rather than the seed array.
const a = new Int16Array(6)
a[0] = 70000
a[1] = 32768
a[2] = -32769
a[3] = 1.9
a[4] = -1.9
a[5] = 65536
for (let i = 0; i < a.length; i++) console.log('i16', i, a[i])
const b = new Uint16Array(6)
b[0] = -1
b[1] = 65536
b[2] = 3.7
b[3] = -0.5
b[4] = 1e9
b[5] = -1e9
for (let i = 0; i < b.length; i++) console.log('u16', i, b[i])
