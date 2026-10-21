// A recursive union (an arm that reaches the union again) handed to an
// `unknown` parameter: the conversion walk has to terminate.
type V = string | number | null | V[] | Map<string, V>;
function isArr(x: unknown): boolean { return Array.isArray(x); }
function f(v: V): string { return isArr(v) ? "array" : "other"; }
console.log(f([1, "a"]), f("s"), f(null), f(new Map<string, V>()));
