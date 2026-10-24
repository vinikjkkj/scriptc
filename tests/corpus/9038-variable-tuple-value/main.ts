type Pair = [label: string, ...values: number[]];
function total(p: Pair): number {
  let t = 0;
  for (let i = 1; i < p.length; i++) t += p[i] as number;
  return t;
}
const pairs: Pair[] = [["a", 1, 2], ["b"], ["c", 5]];
for (const p of pairs) console.log(p[0], total(p));
