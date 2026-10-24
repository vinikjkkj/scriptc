type Pair = [unknown, string[]];
function first(p: Pair): unknown { return p[0]; }
function parse(s: string): Pair {
  return JSON.parse(s) as Pair;
}
function viaUnknown(u: unknown): Pair {
  return u as Pair;
}
const p = parse('[{"a":1},["x","y"]]');
console.log(first(p), p[1].length, p);
const q = viaUnknown([null, ["z"]]);
console.log(q[0], q[1]);
type Row = [number | string, { n: number; tag: string }[]];
function row(u: unknown): Row { return u as Row; }
console.log(row([3, [{ n: 1, tag: "a" }, { n: 2, tag: "t" }]]));
const r2 = row(["s", []]);
console.log(r2, r2[1].length);
type Out = [unknown, { name: string; type: number }[]];
async function load(): Promise<unknown> {
  return [[{ id: 1 }, { id: 2 }], [{ name: "id", type: 3 }]];
}
async function main(): Promise<void> {
  const out = (await load()) as Out;
  console.log(out[0], out[1].map((f) => f.name));
}
main();
type U = [unknown, string[]] | number | string;
function arm(u: unknown): string {
  const v = u as U;
  if (typeof v === "number") return "num " + v;
  if (typeof v === "string") return "str " + v;
  return "tuple " + v[1].join("+");
}
console.log(arm(5), arm("s"), arm([{ q: 1 }, ["a", "b"]]));
