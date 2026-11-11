// `x instanceof Array` and `x instanceof Object` on unknown, static, union and caught values. Both were refused (SC1090, "right-hand sides other than classes declared
// in the program"). Array answers for arrays and tuples; Object for every non-null object-like value, never a primitive, null or undefined.
function kinds(v: unknown): string {
  return [v instanceof Array, v instanceof Object].join(",");
}
console.log(kinds([1, 2]), kinds({ a: 1 }), kinds("s"), kinds(5), kinds(null), kinds(undefined), kinds(true), kinds(() => 1), kinds(new Map<string, number>()), kinds([]), kinds(new Date(0)));
class K { }
console.log(kinds(new K()), kinds(new Error("e")), kinds(new Uint8Array(2)), kinds(JSON.parse("[1]")), kinds(JSON.parse("{}")), kinds(JSON.parse("null")), kinds(JSON.parse("3")));
const arr: number[] = [1];

console.log(arr instanceof Array, arr instanceof Object);
const u: number[] | string | null = Math.random() > 2 ? "s" : [3];
console.log(u instanceof Array, u instanceof Object);
const t: [number, string] = [1, "a"];
console.log(t instanceof Array, t instanceof Object);
const rec = { n: 1 };
console.log(rec instanceof Object, rec instanceof Array);
async function f(): Promise<void> { throw [1]; }
async function g(): Promise<void> { throw "s"; }
async function h(): Promise<void> { throw new K(); }
(async () => {
  for (const fn of [f, g, h]) { try { await fn(); } catch (e) { console.log("caught", e instanceof Array, e instanceof Object); } }
})();
function narrow(v: unknown): string { if (v instanceof Array) return "arr" + v.length; return "other"; }
console.log(narrow([1, 2, 3]), narrow("x"));
