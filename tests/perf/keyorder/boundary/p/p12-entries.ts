interface R { a: string; b: string }
const r: R = { b: "B", a: "A" }
console.log("entries=" + Object.entries(r).map((e) => e[0] + ":" + e[1]).join(","))
console.log("values=" + Object.values(r).join(","))
