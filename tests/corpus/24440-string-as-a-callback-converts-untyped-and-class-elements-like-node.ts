// `String` passed as a function value to an untyped array's method (`xs.map(String)`) is the same conversion as `(x) => String(x)`:
// a plain object is "[object Object]", an array joins, null and undefined render, a symbol renders as Symbol(desc), and an
// own toString runs. Static arrays of records and class instances take the same callback.
class Money { cents: number; constructor(cents: number) { this.cents = cents; } toString(): string { return "$" + (this.cents / 100).toFixed(2); } }
class Plain { n: number; constructor(n: number) { this.n = n; } }
class OnlyValueOf { n: number; constructor(n: number) { this.n = n; } valueOf(): number { return this.n; } }

// primitives and containers, as a callback of an untyped array
const a: any[] = [1, -0, 1.5, 1e21, "x", "", { k: 1 }, [2, [3]], [null, undefined, 1], null, undefined, true, false, NaN, Infinity];
console.log(a.map(String).join("|"));
const out: string[] = a.map(String);
console.log(out.length, out[6], out[7], out[9], out[10]);
console.log(a.map(String).join("|") === a.map((v) => String(v)).join("|"));

// class instances: an own toString, none, and a valueOf alone (String asks toString first)
const inst: any[] = [new Money(1234), new Plain(1), new OnlyValueOf(7)];
console.log(inst.map(String).join("|"));

// symbols render in String()
const syms: any[] = [Symbol("s"), Symbol(), Symbol("")];
console.log(syms.map(String).join("|"));

// nested objects and an own toString on a plain object
const deep: any[] = [{ a: { b: [1, { c: 2 }] } }, { toString() { return "own"; } }];
console.log(deep.map(String).join("|"));

// the other iteration methods take the same function value
console.log(a.filter((v) => typeof v === "object" && v !== null).map(String).join("|"));
a.forEach((v, i) => { if (i < 3) console.log(String(v)); });

// static element types: records, class instances, arrays, optionals
const recs = [{ k: 1 }, { j: 2 }];
console.log(recs.map(String).join("|"));
const objs = [new Money(1234), new Money(5)];
console.log(objs.map(String).join("|"));
const plains = [new Plain(1)];
console.log(plains.map(String).join("|"));
const arrs = [[1, 2], [3]];
console.log(arrs.map(String).join("|"));
const opt: (number | undefined)[] = [1, undefined];
console.log(opt.map(String).join("|"));
