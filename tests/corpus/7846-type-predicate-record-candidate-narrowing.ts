// A user type predicate whose candidate (`Record<string, V>`) is not an arm
// of the declared union (`Record<string, unknown>`): the narrowed value
// flows into a parameter typed at the candidate.
type V = string | number | null;
type U = string | number | V[] | Set<V> | Map<string, V> | Record<string, unknown> | null | undefined;
const isRecord = (value: unknown): value is Record<string, V> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Set) &&
  !(value instanceof Map);
const render = (object: Record<string, V> | Map<string, V>): string => {
  let s = "";
  if (object instanceof Map) {
    for (const [k, v] of object) s += k + "=" + String(v) + ";";
    return "map{" + s + "}";
  }
  for (const k in object) {
    if (!Object.prototype.hasOwnProperty.call(object, k)) continue;
    s += k + ":" + String(object[k]) + ";";
  }
  return "rec{" + s + "}";
};
function f(value: U): string {
  if (typeof value === "object" && value !== null) {
    if (Array.isArray(value)) return "arr";
    if (value instanceof Set) return "set";
    if (isRecord(value) || value instanceof Map) return render(value);
  }
  return "other:" + typeof value;
}
const rec: Record<string, unknown> = {};
rec["a"] = 1;
rec["b"] = "x";
rec["c"] = null;
console.log(f(rec), f(new Map<string, V>([["k", 2], ["j", null]])), f([1, "a"]), f(new Set<V>([1])), f(7), f(null), f(undefined), f("s"));
const g = (value: U): string => {
  const expandable = isRecord(value) || value instanceof Map;
  if (expandable) return render(value);
  return "no";
};
console.log(g(rec), g(new Map<string, V>([["z", 1]])), g(3));
