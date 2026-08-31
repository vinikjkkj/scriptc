interface M { n: number }
interface C { op: string }
type R = M | readonly [M, C];
function s(v: R): string { if (!Array.isArray(v)) return "plain"; const t = v; return String(t[0].n); }
console.log(s({ n: 14 }));
console.log(s([{ n: 12 }, { op: "r" }] as readonly [M, C]));
