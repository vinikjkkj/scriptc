interface M { n: number }
interface C { op: string }
function isFixed(v: [M, C]): boolean { return Array.isArray(v); }
console.log(isFixed([{ n: 11 }, { op: "direct" }]));
