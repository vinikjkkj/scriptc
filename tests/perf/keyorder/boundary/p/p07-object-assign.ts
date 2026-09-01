const base = { b: 1, a: 2 }
const o = Object.assign({} as Record<string, number>, base)
console.log("keys=" + Object.keys(o).join(","))
