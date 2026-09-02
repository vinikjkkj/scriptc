const base = { b: 1, a: 2 }
const t = { ...base, c: 3 }
const h = { c: 3, ...base }
console.log("tail=" + Object.keys(t).join(","))
console.log("head=" + Object.keys(h).join(","))
