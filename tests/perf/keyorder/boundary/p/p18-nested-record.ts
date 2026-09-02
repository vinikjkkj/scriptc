interface Inner { x: number; y: number }
interface Outer { p: Inner; q: number }
const o: Outer = { q: 1, p: { y: 2, x: 3 } }
console.log("outer=" + Object.keys(o).join(","))
console.log("inner=" + Object.keys(o.p).join(","))
console.log("json=" + JSON.stringify(o))
