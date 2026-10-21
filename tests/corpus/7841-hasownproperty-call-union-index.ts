// hasOwnProperty.call over an index-signature record whose value type is
// already a union, in both the aliased and the direct spelling.
const hasOwn = Object.prototype.hasOwnProperty;
type V = string | number | null | undefined | boolean;
function probe(o: Record<string, V>, keys: string[]): string {
  let s = "";
  for (const k of keys) {
    s += (hasOwn.call(o, k) ? "1" : "0") + (Object.prototype.hasOwnProperty.call(o, k) ? "1" : "0");
  }
  return s;
}
function walk(o: Record<string, V> | Map<string, V>): string {
  let s = "";
  if (o instanceof Map) {
    for (const [k, v] of o) s += k + "=" + String(v) + ";";
    return s;
  }
  for (const k in o) {
    if (!hasOwn.call(o, k)) continue;
    s += k + ":" + String(o[k]) + ";";
  }
  return s;
}
const r: Record<string, V> = {};
r["a"] = 1;
r["b"] = "two";
r["c"] = null;
r["d"] = undefined;
r["e"] = false;
const keys = ["a", "b", "c", "d", "e", "f", "toString", "constructor", "__proto__", "hasOwnProperty", ""];
console.log(probe(r, keys));
console.log(walk(r));
console.log(walk(new Map<string, V>([["m", 2], ["n", null]])));
delete r["a"];
console.log(probe(r, keys));
const empty: Record<string, V> = {};
console.log(probe(empty, keys));
const nums: Record<string, number | string> = { x: 1, y: "z" };
console.log(hasOwn.call(nums, "x"), hasOwn.call(nums, "q"));
