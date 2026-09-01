interface R { a: string; b: string }
const r: R = { b: "B", a: "A" }
let out = ""
for (const k in r) out += k + ";"
console.log("forin=" + out)
