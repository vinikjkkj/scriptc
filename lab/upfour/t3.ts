interface M { n: number }
interface C { op: string }
type R = M | readonly [M, C];
function d(v: R): string { if (Array.isArray(v)) return `${v[0].n}:${v[1].op}`; return "plain"; }
console.log(d({ n: 13 }));
const rt: readonly [M, C] = [{ n: 12 }, { op: "readonly" }];
console.log(d(rt));
