const h = new Map<string | number, number>();
for (let i = 0; i < 2000; i++) { h.set(i, i * 2); h.set(String(i), i * 3); }
let t = 0;
for (let i = 0; i < 2000; i++) t += (h.get(i) ?? 0) + (h.get(String(i)) ?? 0);
console.log(h.size, t);
