interface M { n: number }
interface C { op: string }
const rt: readonly [M, C] = [{ n: 12 }, { op: "readonly" }];
console.log(rt[0].n, rt[1].op, rt.length);
console.log(Array.isArray(rt));
