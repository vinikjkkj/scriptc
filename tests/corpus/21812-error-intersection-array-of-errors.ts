// Arrays and maps of an error intersection keep the member: written, then read in the same block.
type Coded = Error & { code: string };
const xs: Coded[] = [];
for (const c of ['A', 'B']) {
  const e = new Error('e' + c) as Coded;
  e.code = 'C_' + c;
  console.log(e.message, e.code);
  xs.push(e);
}
console.log(xs.map((x) => x.message).join(' '));
const m = new Map<string, Coded>();
m.set('k', xs[1]);
console.log(m.get('k')?.message, m.size);
