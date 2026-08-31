interface M { n: number }
interface C { op: string }
type R = M | readonly [M, C];
function s(v: R): string { if (!Array.isArray(v)) return "plain"; return String(v.length); }
console.log(s({ n: 14 }));
console.log(s([{ n: 12 }, { op: "r" }] as readonly [M, C]));
