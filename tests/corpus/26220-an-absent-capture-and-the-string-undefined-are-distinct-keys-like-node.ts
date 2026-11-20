const m = "Wx".match(/(W)(y)?/)!;
const u: string = m[2] as string;
const real: string = "undefi" + (process.argv.length > 50 ? "q" : "ned");
const mp = new Map<string, number>([[real, 1]]);
console.log(mp.get(u), mp.has(u), mp.get(real));
mp.set(u, 7);
console.log(mp.size, mp.get(u), mp.get(real), mp.has(u));
const st = new Set<string>([real]);
console.log(st.has(u), st.has(real));
st.add(u); console.log(st.size, st.has(u), st.has(real));
console.log([real].includes(u), [real].indexOf(u), [u].includes(real), [u, real].indexOf(real));
console.log(u === real, real === u, u !== real, u === u);
switch (u) { case real: console.log("real"); break; default: console.log("dflt"); }
const rec: Record<string, number> = { undefined: 2, a: 1 };
console.log(rec[u], rec[real]);
rec[u] = 5;
console.log(rec[real], Object.keys(rec).join());
delete rec[u];
console.log(Object.keys(rec).join());
