interface P { a: number; b: number; }
const N = 40000;
const keep: (P | null)[] = [];
for (let i = 0; i < N; i++) keep.push({ a: i, b: i });
setTimeout(() => {
  for (let i = 0; i < N; i += 2) keep[i] = null;   // free every other object
  setTimeout(() => { let s = 0; for (const k of keep) if (k) s += k.a; console.log("alive", keep.filter(k => k !== null).length, s); }, 5);
}, 5);
