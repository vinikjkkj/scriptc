interface R { a: string; d?: number }
const r: R = { a: 'x' }
console.log('a=' + r.a + ' d=' + String(r.d))
