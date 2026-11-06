interface A { a?: number; b?: number }
interface B { a?: number; b?: number; c?: number }
const p: A = { b: 1, a: 2 }
const q: A = { a: 3, b: 4 }
const wide: B = p as unknown as B
console.log(JSON.stringify(p), JSON.stringify(q), wide.c)
console.log(JSON.stringify(wide), Object.keys(wide))
