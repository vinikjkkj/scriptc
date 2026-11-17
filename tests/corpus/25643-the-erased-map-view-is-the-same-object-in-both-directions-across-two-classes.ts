// Pass-through to a second erased parameter, a function (not a method) with an erased parameter, and a map compared against itself.
interface Entry { k: string; v: number[] }
function sameMap(a: Map<string, unknown>, b: Map<string, unknown>): boolean { return a === b; }
function countOf(m: Map<string, unknown>): number { return m.size; }
function forward(m: Map<string, unknown>, key: string): string { return describe(m, key); }
function describe(m: Map<string, unknown>, key: string): string { return m.has(key) + ":" + m.size; }
const left = new Map<string, Entry>();
const right = new Map<string, Entry>();
const words = new Map<string, string>();
left.set("one", { k: "one", v: [1] });
right.set("one", { k: "one", v: [1] });
words.set("w", "x");
console.log(sameMap(left, left), sameMap(left, right), sameMap(left, words), sameMap(words, words));
console.log(countOf(left), countOf(words), forward(left, "one"), forward(right, "two"), forward(words, "w"));
left.delete("one");
console.log(countOf(left), forward(left, "one"));
const alias = left;
alias.set("two", { k: "two", v: [2, 3] });
console.log(sameMap(alias, left), countOf(alias), left.get("two")!.v.length);
