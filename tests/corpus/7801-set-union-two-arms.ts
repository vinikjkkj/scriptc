type S = Set<number> | Set<string>;
const a = new Set<number>([3, 1, 2]);
const b = new Set<string>(["x", "y"]);
let u: S = a;
console.log(u.size);
u.delete(1 as never);
console.log(a.size);
u = b;
console.log(u.size);
for (const v of u) console.log(v);
u.forEach((v, w) => console.log(v, w));
console.log(u instanceof Set, a instanceof Set);
function f(x: string | S): string { return x instanceof Set ? "set" + x.size : x; }
console.log(f(a), f("s"), f(b));
