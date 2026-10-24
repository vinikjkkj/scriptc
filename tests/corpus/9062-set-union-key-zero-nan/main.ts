const s = new Set<string | number>();
s.add("1"); s.add(1); s.add(NaN); s.add(NaN); s.add(-0); s.add(0); s.add("x");
console.log(s.size, s.has("1"), s.has(1), s.has(NaN), s.has(0));
console.log([...s].map((v) => typeof v + ":" + String(v)).join("|"));
