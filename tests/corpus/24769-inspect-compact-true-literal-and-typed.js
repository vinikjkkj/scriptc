import util from "node:util";
const rec = { name: "n", tags: ["a", "b", "c"], nested: { deep: { x: 1, y: "z".repeat(60) }, k: "w".repeat(40) } };
class Pt { constructor() { this.x = 1; this.y = "q".repeat(70); this.z = [1, 2, 3]; } }
console.log(util.inspect(rec, { compact: true }));
console.log(util.inspect(rec, { compact: true, breakLength: 50 }));
console.log(util.inspect(new Pt(), { compact: true }));
console.log(util.inspect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { compact: true }));
console.log(util.inspect(new Map([["a", 1]]), { compact: true, depth: 0 }));
console.log(util.inspect(rec, { compact: true, colors: true }));
const c = false;
console.log(util.inspect(rec, { compact: c }));
let flag = process.argv.length > 99;
console.log(util.inspect(rec, { compact: flag }));
flag = !flag;
console.log(util.inspect(rec, { compact: flag }));
console.log(util.formatWithOptions({ compact: true }, "%O", rec));
