// Object.assign returns its target. onto a fresh literal (`{}` or `{} as Record<..>`) the result is the merged record: its members
// read through the names the sources declare, and it enumerates the sources' keys in order.
interface A { a?: number; b?: number }
interface B { b?: number; c?: number }
const fa: A = { a: 1, b: 2 };
const fb: B = { c: 3 };
const t = Object.assign({} as Record<string, number | undefined>, fa);
console.log(Object.keys(t).join(","), JSON.stringify(t), t.a, t.b);
const u = Object.assign({} as Record<string, number | undefined>, fa, fb);
console.log(Object.keys(u).join(","), JSON.stringify(u), u.a, u.c);
const v = Object.assign({}, fa, fb);
console.log(Object.keys(v).join(","), JSON.stringify(v), v.a, v.b, v.c);
console.log(t.a, v.a, fa.a);
v.a = 99;
console.log(v.a, fa.a, JSON.stringify(v));
