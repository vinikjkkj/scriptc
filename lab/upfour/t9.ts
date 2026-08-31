interface M { n: number }
interface C { op: string }
type R = M | readonly [M, C];
function s(v: R): string { if (!Array.isArray(v)) return "plain"; let k = 0; for (const _p of v) k++; return String(k); }
console.log(s({ n: 14 }));
console.log(s([{ n: 12 }, { op: "r" }] as readonly [M, C]));
