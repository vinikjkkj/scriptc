type M = Map<string, number> | Map<string, string>;
const nums = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
const strs = new Map<string, string>([["x", "y"]]);
let u: M = nums;
nums.set("d", 4);
console.log(u.size, u.get("d"));
console.log(u.delete("a"), nums.has("a"), u.has("a"));
u = strs;
console.log(u.size, u.get("x"), u.get("nope"));
const g = u.get("x");
if (typeof g === "string") console.log("g is string", g.length);
u.clear();
console.log(strs.size, u.size);
function pick(c: boolean): M | undefined { return c ? nums : undefined; }
const p = pick(true);
console.log(p?.size, pick(false)?.size);
if (p) { for (const [k, v] of p) console.log(k, v); }
const arr: M[] = [nums, strs];
let total = 0;
for (const m of arr) total += m.size;
console.log(total);
const holder = { m: nums as M, n: 1 };
console.log(holder.m.size + holder.n);
function emptyOne(): M { return new Map<string, number>(); }
console.log(emptyOne().size);

type M2 = Map<string, number> | Map<number, string>;
const a2 = new Map<string, number>([["a", 1]]);
const b2 = new Map<number, string>([[7, "seven"]]);
function show2(m: M2): string {
  let out = "" + m.size;
  for (const [k, v] of m) out += " " + k + "=" + v;
  m.forEach((v, k) => { out += " fe:" + k + "=" + v; });
  return out;
}
console.log(show2(a2));
console.log(show2(b2));
