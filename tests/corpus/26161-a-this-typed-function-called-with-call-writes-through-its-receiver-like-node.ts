// `this: T` functions reached only through .call / .apply: a write through `this` lands on the object the caller passed.
interface Counter { n: number; tag: string; log: number[] }
function bump(this: Counter, by: number): number { this.n += by; this.tag = this.tag + "!"; this.log.push(by); return this.n; }
const c: Counter = { n: 1, tag: "a", log: [] };
console.log(bump.call(c, 2), c.n, c.tag, c.log);
console.log(bump.apply(c, [5]), c.n, c.tag, c.log);
console.log(bump.call({ n: 0, tag: "x", log: [] }, 4));
class Acc { v = 10; hist: string[] = []; }
function inc(this: Acc, d: number): Acc { this.v += d; this.hist.push("i" + d); return this; }
const acc = new Acc();
const back = inc.call(acc, 3);
console.log(back === acc, acc.v, acc.hist, inc.apply(acc, [4]) === acc, acc.v);
const viaArrow = function (this: Counter, by: number) { const add = () => { this.n += by; }; add(); add(); return this.n; };
const c2: Counter = { n: 0, tag: "t", log: [] };
console.log(viaArrow.call(c2, 3), c2.n);
function swapTag(this: Counter, t: string): string { const old = this.tag; this.tag = t; return old; }
console.log(swapTag.call(c2, "new"), c2.tag, c2);
