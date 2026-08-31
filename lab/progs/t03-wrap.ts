// Element clamping / wraparound: the case the brief names by value.
const a = new Int16Array([70000, 32767, 32768, -32768, -32769, 65535, 65536, -1])
for (let i = 0; i < a.length; i++) console.log('i16', i, a[i])
const b = new Uint16Array([70000, 32767, 32768, -32768, -32769, 65535, 65536, -1])
for (let i = 0; i < b.length; i++) console.log('u16', i, b[i])
