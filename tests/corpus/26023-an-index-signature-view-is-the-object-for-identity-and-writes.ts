// Identity, a write through the cast and a write through the original, both ways, and the key order.
const mk: any = new Function("return { a: 1, b: 2 }");
const o: any = mk();
const r = o as Record<string, number>;
const r2 = o as Record<string, number>;
console.log(r === r2, (r as any) === o);
r.z = 9; console.log(o.z);
o.q = 5; console.log(r.q, Object.keys(r).join(","));
delete o.a; console.log(Object.keys(r).join(","), r.a);
r.b = 7; console.log(o.b);
o.b = 8; console.log(r.b);
const m = new Map<Record<string, number>, number>(); m.set(r, 1); console.log(m.get(r2));
