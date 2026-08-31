// The copy constructor and cross-width construction.
const src = new Int16Array([1, -2, 3])
const cp = new Int16Array(src)
cp[0] = 9
console.log(src[0], cp[0], cp.length, cp.byteLength)
const fromArr = new Int16Array([1.7, -1.7])
console.log(fromArr[0], fromArr[1])
const big = new Uint16Array(new ArrayBuffer(8))
console.log('u16 over ab8', big.length, big.byteLength)
