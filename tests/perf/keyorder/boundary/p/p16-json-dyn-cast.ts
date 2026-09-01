interface R { a: string; b: string }
const src: unknown = JSON.parse('{"b":"B","a":"A"}')
const r = src as R
console.log("json=" + JSON.stringify(r))
let out = ""
for (const k in r) out += k + ";"
console.log("forin=" + out)
