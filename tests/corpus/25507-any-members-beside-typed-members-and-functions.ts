// A variable literal mixing typed members, functions, nested literals and any-typed members; typed reads stay typed.
const n: any = 5;
const o: any = { a: 1 };
const r = { name: "box", count: 3, n, o, tags: ["x", "y"], inner: { depth: 1, v: n }, f: (x: number) => x + 1 };
console.log(r);
console.log(r.name.toUpperCase(), r.count * 2, r.tags.length, r.inner.depth + 1, r.f(41));
r.count += 1;
r.tags.push("z");
r.inner.v = "inner changed";
console.log(r.count, r.tags, r.inner, r.n, r.o);
