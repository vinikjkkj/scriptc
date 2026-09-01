interface R { a: number; b: number; c: number }
function mk(): R { return { c: 3, a: 1, b: 2 } }
const r = mk()
console.log("keys=" + Object.keys(r).join(","))
