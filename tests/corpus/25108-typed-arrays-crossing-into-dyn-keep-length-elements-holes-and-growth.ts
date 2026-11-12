// A typed array that crosses into a dynamic value is converted element by element into a dyn array whose buffer is sized once for the length
// being written. Lengths on both sides of every size a buffer could be rounded to (0, 1, 2, 3, 4, 5, 8, 9, 751, 1024, 1025), strings and
// numbers and unions of both, nested arrays and holes are checked against Node; so are the observable operations afterwards: length,
// indexing, JSON, String(), push past the converted length (which must grow), pop, and a second crossing of the same array.
type P = string | number | null;
function pad(n: number, salt: number): P[] {
  const a: P[] = [];
  for (let i = 0; i < n; i++) a.push(i % 5 === 0 ? "k" + salt + "_" + i : i % 3 === 0 ? null : i % 2 === 0 ? -1 : "");
  return a;
}
function show(label: string, u: unknown): void {
  const j = JSON.stringify(u);
  console.log(label, j.length, j.slice(0, 40), j.slice(-24));
}
const sizes = [0, 1, 2, 3, 4, 5, 8, 9, 100, 751, 1024, 1025];
for (const n of sizes) {
  const a = pad(n, n);
  const u: unknown = a;
  show("pad" + n, u);
  console.log("len", n, (u as any).length, String(u).length);
}
// operations after the crossing
const b = pad(751, 7);
const ub: unknown = b;
(ub as any).push("tail");
(ub as any).push(42);
console.log((ub as any).length, (ub as any)[751], (ub as any)[752], (ub as any).pop(), (ub as any).length);
show("grown", ub);
console.log(b.length);
// numbers, strings, nested
const nums: number[] = [];
for (let i = 0; i < 300; i++) nums.push(i * 1.5);
const strs: string[] = [];
for (let i = 0; i < 129; i++) strs.push("s" + i);
const nested: number[][] = [];
for (let i = 0; i < 40; i++) { const r: number[] = []; for (let k = 0; k < i % 7; k++) r.push(i + k); nested.push(r); }
show("nums", nums as unknown);
show("strs", strs as unknown);
show("nested", nested as unknown);
// holes
const holey: number[] = new Array(6);
holey[1] = 5; holey[4] = 9;
const uh: unknown = holey;
console.log(JSON.stringify(uh), (uh as any).length, 0 in (uh as any), 1 in (uh as any));
// many crossings held live
const keep: unknown[] = [];
let total = 0;
for (let q = 0; q < 200; q++) { const x = pad(60 + (q % 9), q); keep.push(x as unknown); total += (keep[keep.length - 1] as any).length; }
console.log("held", keep.length, total);
