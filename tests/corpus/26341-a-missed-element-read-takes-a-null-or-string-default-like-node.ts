// `list[i] ?? null` over a non-nullable element type: tsc types the whole expression as the element, but a miss must answer the default.
const n = [1, 2];
const s = ["a", "b"];
const o = [{ k: 1 }];
const b = [true];
let i = 5;
console.log(n[i] ?? null, s[i] ?? null, o[i] ?? null, b[i] ?? null);
console.log(n[i] ?? "none", n[i] ?? undefined, s[i] ?? undefined, s[i] ?? "d");
// A hit keeps the element, including the falsy ones.
const z = [0];
const e = [""];
console.log(n[0] ?? null, s[1] ?? null, o[0] ?? null, z[0] ?? null, e[0] ?? null, z[0] ?? "d");
function pick(a: number[], k: number): number | null {
  return a[k] ?? null;
}
function name(a: string[], k: number): string | null {
  return a[k] ?? null;
}
console.log(pick(n, 9), pick(n, 1), name(s, 9), name(s, 0));
interface R {
  a: string | null;
  b: number | null;
}
const r: R = { a: s[i] ?? null, b: n[i] ?? null };
console.log(r, JSON.stringify(r));
const m = new Map<string, number | null>();
m.set("k", n[i] ?? null);
console.log(m.get("k"), m.get("k") === null);
console.log((n[i] ?? null) === null, (n[0] ?? null) === null, (s[i] ?? null) !== null);
function show(x: number | string | null): string {
  return String(x);
}
console.log(show(n[i] ?? "d"), show(n[i] ?? null), show(n[0] ?? null));
