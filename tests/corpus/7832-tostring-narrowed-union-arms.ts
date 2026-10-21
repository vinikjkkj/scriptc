// String conversion of a union read the checker narrowed to SOME of its arms.
// A narrowing to several arms keeps the whole union's representation, so the
// conversion dispatches on the tag over exactly the arms the guard left.
type V = string | number | bigint | boolean | number[] | Set<string> | null | undefined;

function scalarText(v: V): string {
  if (typeof v === "number" || typeof v === "bigint") return v + "";
  if (typeof v === "string") return "'" + v + "'";
  return "x";
}
function noObjects(v: V): string {
  if (typeof v === "object" && v !== null) return "obj";
  return String(v);
}
function viaTemplate(v: V): string {
  if (typeof v === "object" && v !== null) return "obj";
  return `<${v}>`;
}
const samples: V[] = [1, -0, 2.5, 3n, "s", true, false, null, undefined, [1], new Set<string>()];
for (const s of samples) console.log(scalarText(s), noObjects(s), viaTemplate(s));

function wide(v: number | bigint | string): string { return String(v) + "|" + v; }
console.log(wide(1), wide(2n), wide("q"));
