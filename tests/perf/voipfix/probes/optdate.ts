interface R { a: string; d?: Date }
const r: R = { a: 'x' }
console.log('a=' + r.a + ' d=' + String(r.d))
const r2: R = { a: 'y', d: new Date(0) }
console.log('d2=' + (r2.d === undefined ? 'undef' : r2.d.toISOString()))
