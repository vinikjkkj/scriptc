const cold = process.env.COLD === "1";
const n = process.argv.length;
let r = 0;
if (cold) { const g = new Function("x", "return (x + " + n + ") * 3"); for (let i = 0; i < 50; i++) r += g(i) as number; }
console.log(r, n > 0);
