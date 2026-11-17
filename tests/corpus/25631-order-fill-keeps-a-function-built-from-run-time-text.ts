const cold = process.env.COLD === "1";
const k = process.argv.length + 9;
const f = new Function("a", "b", "return a * " + k + " + b");
let s = 0;
for (let i = 0; i < (cold ? 300 : 3); i++) s += f(i, 1) as number;
console.log(s, typeof f);
