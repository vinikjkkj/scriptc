// Index-signature records and Maps of Date values (the handle is refcounted storage).
const m: Record<string, Date> = {};
m["a"] = new Date(1000);
m["b"] = new Date(2000);
let sum = 0;
for (const k of Object.keys(m)) sum += m[k]!.getTime();
console.log(sum, "a" in m, m["zz"] === undefined);
const n: { [k: string]: Date | undefined } = { x: new Date(5) };
n["y"] = undefined;
console.log(Object.keys(n).length, n["x"]?.getTime());
function f(r: Record<string, Date>): number { return r["a"] ? r["a"].getTime() : -1; }
console.log(f(m), f({}));
const mm = new Map<string, Date>();
mm.set("k", new Date(7));
mm.get("k")!.setTime(8);
console.log(mm.get("k")!.getTime(), mm.size, mm.has("q"));
const arrOfRec: Record<string, Date>[] = [{ p: new Date(1) }, { p: new Date(2), q: new Date(3) }];
let tot = 0;
for (const r of arrOfRec) for (const k in r) tot += r[k]!.getTime();
console.log(tot);
delete m["a"];
console.log(Object.keys(m).join(","), Object.entries(m).map(([k, v]) => k + v.getTime()).join(","));
const shared = new Date(100);
const r2: Record<string, Date> = { one: shared, two: shared };
r2["one"]!.setUTCFullYear(2001);
console.log(r2["two"]!.getUTCFullYear(), r2["one"] === r2["two"]);
for (let i = 0; i < 1000; i++) r2["k" + (i % 50)] = new Date(i);
console.log(Object.keys(r2).length);
