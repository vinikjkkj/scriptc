interface R { a: string; b: string }
const r: R = { b: "B", a: "A" }
console.log("keys=" + Object.keys(r).join(","))
console.log("vals=" + Object.values(r).join(","))
