function show(v: string | Map<string, number> | Map<string, string>): string {
  if (typeof v === "string") return "str " + v;
  let out = "map " + v.size;
  for (const [k, x] of v) out += " " + k + "=" + x;
  return out;
}
console.log(show("hi"));
console.log(show(new Map<string, number>([["a", 1]])));
console.log(show(new Map<string, string>([["b", "z"]])));

type MM = Map<string, number> | Map<string, string>;
const a = new Map<string, number>([["a", 1], ["b", 2]]);
const b = new Map<string, string>([["x", "y"]]);
function walk(m: MM): string {
  let out = "";
  for (const k of m.keys()) out += k;
  for (const v of m.values()) out += v;
  for (const [k, v] of m.entries()) out += k + v;
  return out;
}
console.log(walk(a), walk(b));
type SS = Set<number> | Set<string>;
function gw(s: SS): string { let o = ""; for (const v of s.values()) o += v; return o; }
console.log(gw(new Set<number>([1, 2])), gw(new Set<string>(["q"])));
