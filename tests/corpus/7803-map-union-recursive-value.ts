type V = string | number | boolean | null | undefined | Map<string, V>;
function esc(v: V): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "string") return "'" + v + "'";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  let s = "{";
  for (const [k, x] of v) s += k + ":" + esc(x) + ",";
  return s + "}";
}
console.log(esc("a"), esc(1), esc(null));
console.log(esc(new Map<string, V>([["k", 1], ["j", new Map<string, V>([["z", "q"]])]])));

function stringify(v: number | boolean | Map<string, number> | Set<string>): string {
  return "" + v + "|" + String(v) + `|${v}`;
}
console.log(stringify(1), stringify(true), stringify(new Map<string, number>()), stringify(new Set<string>()));
