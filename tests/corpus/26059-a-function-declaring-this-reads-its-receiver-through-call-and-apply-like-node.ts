// A function that declares this: T reads its receiver through .call and .apply and as a callback, like Node.
interface Counter { n: number; label: string }
function bump(this: Counter, by: number): number { return this.n + by; }
function describe(this: Counter): string { return this.label + "=" + this.n; }
const c1: Counter = { n: 1, label: "a" };
const c2: Counter = { n: 10, label: "b" };
console.log(bump.call(c1, 2), bump.apply(c2, [5]), c1.n, c2.n);
console.log(describe.call(c1), describe.call(c2));
function run(f: (this: Counter) => string, who: Counter) { return f.call(who); }
console.log(run(describe, c2));
const fe = function (this: Counter, k: number) { return this.n * k; };
console.log(fe.call(c1, 3), [1, 2].map((k) => fe.call(c2, k)).join());
