// Two different unions compared with ===: the same value must be on both
// sides, a string is never a number, and a class instance answers by identity.
class Query { n = 1; }
function eq(a: string | Query, b: number | Query): boolean { return a === b; }
function ne(a: string | Query, b: number | Query): boolean { return a !== b; }
const q = new Query();
const q2 = new Query();
const s: any = 'x';
const n: any = 1;
console.log(eq(q, q), eq(q, q2), eq(s, n), eq(q, n), ne(s, n), ne(q, q2), ne(q, q));
const pool: Array<string | Query> = ['x', q, 'y'];
const nums: Array<number | Query> = [1, q, 0];
let hits = 0;
for (const p of pool) {
  for (const r of nums) {
    if (eq(p, r)) hits++;
  }
}
console.log(hits);
