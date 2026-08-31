interface M { n: number }
interface C { op: string }
function up(m: M, e: boolean): M | [M, C] { if (!e) return m; return [m, { op: "spawn" }]; }
function norm(m: M, e: boolean): [M, string] {
  const out = up(m, e);
  if (Array.isArray(out)) return [out[0], out[1].op];
  return [out, "none"];
}
const a = norm({ n: 7 }, false);
console.log(a[0].n, a[1]);
const b = norm({ n: 9 }, true);
console.log(b[0].n, b[1]);
