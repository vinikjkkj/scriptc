interface R { a?: number; b?: number }
const r: R = { b: 1 }
console.log("keys=" + Object.keys(r).join(","))
const r2: R = {}
r2.b = 1
r2.a = 2
console.log("keys2=" + Object.keys(r2).join(","))
