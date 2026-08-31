// set() with an offset, subarray aliasing, and slice independence at a
// 2-byte stride — the arithmetic a wrong element size gets wrong.
const a = new Int16Array([1, 2, 3, 4, 5, 6])
const dst = new Int16Array(6)
dst.set(a.subarray(2, 5), 1)
for (let i = 0; i < dst.length; i++) console.log('dst', i, dst[i])
const sub = a.subarray(1, 4)
sub[0] = -99
console.log('alias', a[1], sub[0], sub.length, sub.byteLength)
const cp = a.slice(1, 4)
cp[0] = 7
console.log('copy', a[1], cp[0], cp.length, cp.byteLength)
a.fill(5, 2, 4)
for (let i = 0; i < a.length; i++) console.log('filled', i, a[i])
