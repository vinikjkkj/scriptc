// A closure is three words before its captures (its own-property table and minted prototype sit behind one lazy pointer): every capture count
// from 0 to 6, closures that outlive their creator, counters sharing a captured cell and rings through captured nodes the collector frees.
// closure-heavy: every capture count from 0 to 6, closures that outlive their creator, a ring through a captured box, and many live at once
function mk0(): () => number { return () => 7; }
function mk1(a: number): () => number { return () => a; }
function mk2(a: number, b: number): () => number { return () => a + b; }
function mk3(a: number, b: number, c: number): () => number { return () => a + b + c; }
function mk4(a: number, b: number, c: number, d: number): () => number { return () => a + b + c + d; }
function mk5(a: number, b: number, c: number, d: number, e: number): () => number { return () => a + b + c + d + e; }
function mk6(a: number, b: number, c: number, d: number, e: number, f: number): () => number { return () => a + b + c + d + e + f; }
function counter(): { inc: () => number; get: () => number } {
  let n = 0;
  return { inc: () => { n += 1; return n; }, get: () => n };
}
class Node2 { next: Node2 | null = null; cb: (() => number) | null = null; v: number; constructor(v: number) { this.v = v; } }
function ring(i: number): number {
  const a = new Node2(i); const b = new Node2(i + 1);
  a.next = b; b.next = a;
  a.cb = () => (a.next as Node2).v + b.v;
  b.cb = () => (b.next as Node2).v;
  return (a.cb as () => number)() + (b.cb as () => number)();
}
let total = 0;
const live: (() => number)[] = [];
for (let i = 0; i < 4000; i++) {
  live.push(mk0(), mk1(i), mk2(i, 1), mk3(i, 1, 2), mk4(i, 1, 2, 3), mk5(i, 1, 2, 3, 4), mk6(i, 1, 2, 3, 4, 5));
  const c = counter(); c.inc(); c.inc(); total += c.get();
  total += ring(i);
}
for (const f of live) total += f();
console.log(total, live.length);
for (let r = 0; r < 3; r++) { for (let i = 0; i < live.length; i += 7) total += live[i]!(); }
console.log(total);
