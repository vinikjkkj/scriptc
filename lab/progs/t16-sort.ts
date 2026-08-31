// sort() compiles for the 16-bit kinds (parity with 32-bit): the default
// order is a subtraction, exact where there is no NaN and no signed zero.
const a = new Int16Array([3, -32768, 32767, 0, -1, 100])
a.sort()
for (let i = 0; i < a.length; i++) console.log('i16', i, a[i])
const b = new Uint16Array([3, 65535, 0, 1, 32768])
b.sort()
for (let i = 0; i < b.length; i++) console.log('u16', i, b[i])
