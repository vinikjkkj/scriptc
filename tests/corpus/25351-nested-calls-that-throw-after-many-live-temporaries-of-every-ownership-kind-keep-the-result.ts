// typed lane: strings, arrays, records, class instances, closures and a Map live across a call that throws at depth 1, 2 and 3; the catch sees the right message and the totals match
class Box { s: string; n: number[]; constructor(s: string, n: number[]) { this.s = s; this.n = n; } }
function thrower(k: number, s: string): number { if (k > 0) throw new Error(s + k); return k; }
function l3(k: number, s: string): number {
  const a = [s, s + "!"]; const b = new Box(s, [1, 2, 3]); const r = { s, n: a.length }; const m = new Map<string, number>([[s, k]]);
  const c = () => s.length + a.length;
  const t = thrower(k - 2, s);
  return t + c() + b.n.length + r.n + m.size;
}
function l2(k: number, s: string): number {
  const a = [s]; const b = new Box(s + "b", [k]); const x = s + "x" + k;
  const v = l3(k, x);
  return v + a.length + b.n.length;
}
function l1(k: number, s: string): number {
  const z = [s, s]; const w = { z, s };
  const v = l2(k, s + "y");
  return v + z.length + w.s.length;
}
let ok = 0, bad = 0, msgs = 0;
for (let i = 0; i < 400; i++) {
  try { ok += l1(i % 5, "q" + i); } catch (e) { bad++; msgs += (e as Error).message.length; }
}
console.log(ok, bad, msgs);
