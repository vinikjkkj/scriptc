// String.prototype.split with capture groups that do not participate: the result holds Node's undefined there. The
// element read yields undefined wherever it is consumed (printing, template, typeof, comparisons, ??, ?., property use),
// and util.inspect, JSON.stringify and join treat the slot as Node does (undefined, null, empty).
const t = "k=v;z;q=w".split(/(=)?;?/);
console.log(t);
console.log(t.length, t[3] === undefined, t[1] === undefined, `${t[3]}|${t[1]}`, t[3] ?? "dflt", t[1] ?? "dflt");
console.log(typeof t[3], typeof t[1]);
console.log(JSON.stringify(t));
console.log(t.join("+"), String(t));
for (let i = 0; i < t.length; i++) console.log(i, t[i], t[i] === undefined);
const u = "a-b".split(/(x)?-/);
console.log(u, u[1]);
console.log(!u[1], t[3]?.length, (t[3] || "or"));
let n = 0;
for (let i = 0; i < t.length; i++) if (t[i] === undefined) n++;
console.log(n);
try { console.log(t[3]!.length); } catch (e) { console.log((e as Error).message); }
try { console.log(t[3]!.toUpperCase()); } catch (e) { console.log((e as Error).message); }
