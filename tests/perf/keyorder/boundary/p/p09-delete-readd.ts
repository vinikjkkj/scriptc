const o: Record<string, number> = { a: 1, b: 2 }
delete o["a"]
o["a"] = 3
console.log("keys=" + Object.keys(o).join(","))
