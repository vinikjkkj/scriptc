// typed lane: the k-th checked call of a function throws, so exits with 1..4 live temporaries (strings, arrays, records, class instances, closures, a Map) run in turn
class Box { s: string; n: number[]; constructor(s: string, n: number[]) { this.s = s; this.n = n; } }
let which = -1;
function step(i: number, s: string): number { if (i === which) throw new Error(s + i); return i; }
function chain(r: number, s: string): number {
  let acc = step(0, s);
  const a = [s, s + "!"];
  acc += step(1, s + a.length);
  const b = new Box(s, [1, 2, 3]);
  acc += step(2, b.s);
  const rec = { s, n: a.length };
  const c = () => s.length + a.length + rec.n;
  acc += step(3, s + rec.n);
  const m = new Map<string, number>([[s, r]]);
  acc += step(4, s + m.size);
  return acc + c() + b.n.length + m.size;
}
function outer(r: number, s: string): number {
  const z = [s, s];
  const w = { z, s };
  const v = chain(r, s + "y");
  const q = step(5, w.s);
  return v + q + z.length;
}
let ok = 0, bad = 0, msgs = 0;
for (let i = 0; i < 60; i++) {
  for (which = -1; which <= 5; which++) {
    try { ok += outer(i, "q" + i); } catch (e) { bad++; msgs += (e as Error).message.length; }
  }
}
console.log(ok, bad, msgs);
