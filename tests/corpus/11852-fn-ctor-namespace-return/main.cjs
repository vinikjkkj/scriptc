// A constructor returning nothing keeps the instance; a constructor returning an
// object hands that object back instead, with none of the prototype's methods.
const shapes = require("./lib/shapes.cjs")

const p = new shapes.Plain(21)
console.log(p.x, p.twice(), typeof p.twice, p.hasOwnProperty("twice"))
const r1 = new shapes.Replaced(4)
console.log(r1.x, r1.twice(), r1 instanceof shapes.Replaced)
const r2 = new shapes.Replaced()
console.log(r2.fallback, r2.x, typeof r2.twice, r2 instanceof shapes.Replaced)
