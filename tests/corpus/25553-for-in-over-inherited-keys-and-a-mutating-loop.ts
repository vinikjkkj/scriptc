// Inherited enumerable keys follow the own ones, a shadowed key is visited once, a key deleted before its turn is skipped, and one added during the loop is not visited.
function keys(x: any): string { const out: string[] = []; for (const k in x) out.push(k); return out.join(","); }
const proto = { inh: 1, shadow: 2 };
const kid: any = {}; Object.setPrototypeOf(kid, proto); kid.own = 1; kid.shadow = 3;
const np: any = Object.create(null); np.b = 1; np.a = 2; np[3] = 0;
console.log(keys(kid), "|", keys(np));
const d: any = { a: 1, b: 2, c: 3 };
const seen: string[] = [];
for (const k in d) { seen.push(k); if (k === "a") { delete d.b; d.z = 9; } }
console.log(seen.join(","), Object.keys(d).join(","));
outer: for (const a in { x: 1, y: 2 } as any) { for (const b in { p: 1, q: 2 } as any) { if (b === "q") continue outer; console.log(a, b); } }
