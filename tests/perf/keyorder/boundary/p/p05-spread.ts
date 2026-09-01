interface R { a: number; b: number }
const base: R = { b: 1, a: 2 }
const s = { ...base }
console.log("keys=" + Object.keys(s).join(","))
