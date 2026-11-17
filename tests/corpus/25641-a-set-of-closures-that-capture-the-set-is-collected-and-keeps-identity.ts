// A closure that captures the set holding it: a cycle the collector must see, with identity kept.
function makeRegistry() {
  const set = new Set<() => number>();
  let n = 0;
  const fns: (() => number)[] = [];
  for (let i = 0; i < 3; i++) {
    const f = () => { n += 1; return set.size * 10 + i + n; };
    fns.push(f);
    set.add(f);
  }
  return { set, fns, bump: () => n };
}
for (let round = 0; round < 3; round++) {
  const r = makeRegistry();
  let sum = 0;
  for (const f of r.set) sum += f();
  console.log(round, r.set.size, sum, r.bump(), r.set.has(r.fns[0]!), r.set.has(() => 0));
  r.set.delete(r.fns[1]!);
  console.log(r.set.size, [...r.set].map((f) => f()).join(","));
}
let churn = 0;
for (let i = 0; i < 20000; i++) {
  const s = new Set<() => number>();
  const f = () => s.size + i;
  s.add(f); s.add(f);
  churn += f();
}
console.log(churn);
