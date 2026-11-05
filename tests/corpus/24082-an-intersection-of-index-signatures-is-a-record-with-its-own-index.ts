// An intersection of two index signatures (`Readonly<Partial<T>> & Record<string, any>`, mongodb's MatchKeysAndValues) is a record whose
// index signature is its own: members read and written through it, undefined, and the keys it holds.
interface Doc { [key: string]: any }
type MatchKeysAndValues<T> = Readonly<Partial<T>> & Record<string, any>;
interface U { $min?: MatchKeysAndValues<Doc>; $max?: MatchKeysAndValues<Doc>; n: number }
const u: U = { $min: { a: 1, b: "x" }, n: 2 };
console.log(u.n, JSON.stringify(u.$min!), u.$min!["a"], u.$max === undefined);
u.$max = { c: [1, 2], d: { e: true } };
u.$min!["a"] = 10;
u.$min!["z"] = null;
console.log(JSON.stringify(u.$min!), Object.keys(u.$max!).join(","), JSON.stringify(u.$max!["d"]));
const m = u.$min!;
m["b"] = undefined;
console.log(Object.keys(m).join(","), m["b"], m["nope"]);
