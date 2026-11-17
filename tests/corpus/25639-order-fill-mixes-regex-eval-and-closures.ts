const cold = process.env.COLD === "1";
const n = process.argv.length;
function mk(i: number): () => number { let c = i; return () => (c += 2); }
const fs: (() => number)[] = []; for (let i = 0; i < 6; i++) fs.push(mk(i));
const t = fs.map((f) => f() + f()).join(",");
const h = new Function("s", "return s.split('').reverse().join('') + " + n) as (s: string) => string;
console.log(t, "ab-cd".replace(/(\w+)-(\w+)/, "$2-$1"), cold ? h("xyz") : "-");
