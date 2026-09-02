interface R { a: string; b: string }
const src: unknown = JSON.parse('{"b":"B","a":"A"}')
const r = src as R
console.log("keys=" + Object.keys(r).join(","))
